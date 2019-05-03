"use strict";

let Block = require('./block.js');
let Client = require('./client.js');

const NUM_ROUNDS_MINING = 2000;

const PROOF_FOUND = "PROOF_FOUND";
const START_MINING = "START_MINING";
const INIT_MINTING = "INIT_MINTING";
const POST_TRANSACTION = "POST_TRANSACTION";
const TIME_UNTIL_ELIGIBILITY_DECREASE = 30000; //30 seconds between decrease
const MINT_ELEGIBILITY_DIFFICULTY = 3;//3 bits matching, 1/2^3 chance of eligible

/**
 * Miners are clients, but they also mine blocks looking for "proofs".
 * 
 * Each miner stores a map of blocks, where the hash of the block
 * is the key.
 */
module.exports = class Miner extends Client {
  /**
   * When a new miner is created, but the PoW search is **not** yet started.
   * The initialize method kicks things off.
   * 
   * @param {function} broadcast - The function that the miner will use
   *      to send messages to all other clients.
   */
  constructor(name, broadcast) {
    super(broadcast);

    this.name = name;
    this.mint_elegibility_diff_dyn = MINT_ELEGIBILITY_DIFFICULTY;
    this.previousBlocks = {};
  }

  /**
   * Starts listeners and begins mining.
   * 
   * @param {Block} startingBlock - This is the latest block with a proof.
   *      The miner will try to add new blocks on top of it.
   */
  initialize(startingBlock) {
    this.currentBlock = startingBlock;
    this.on(INIT_MINTING, this.startNewSearch);
    this.on(START_MINING, this.findProof);
    this.on(PROOF_FOUND, this.receiveBlock);
    this.on(POST_TRANSACTION, this.addTransaction);
    this.shouldStartNewBlock = true;
    this.startNewSearch();

    this.emit(START_MINING);
  }

  /**
   * Sets up the miner to start searching for a new block.
   * 
   * @param {boolean} reuseRewardAddress - If set, the miner's previous
   *      coinbase reward address will be reused.
   */
  startNewSearch(reuseRewardAddress=false) {
    
    if(this.shouldStartNewBlock) {
      this.mint_elegibility_diff_dyn = MINT_ELEGIBILITY_DIFFICULTY;
      clearTimeout(this.mintingTimeout);
        // Creating a new address for receiving coinbase rewards.
        // We reuse the old address if 
        if (!reuseRewardAddress) {
          this.rewardAddress = this.wallet.makeAddress();
        }
        
        // Create a new block, chained to the previous block.
        let b = new Block(this.rewardAddress, this.currentBlock);
  
        // Store the previous block, and then switch over to the new block.
        this.previousBlocks[b.prevBlockHash] = this.currentBlock;
        this.currentBlock = b;
  
        // Start looking for a proof at 0.
        this.currentBlock.proof = 0;
        this.shouldStartNewBlock = false;

        //create address to spend coin-age
        let selfAddr = this.wallet.makeAddress();
        this.log("balance: " + this.wallet.balanceOnChain(this));
        this.currentBlock.target = Block.determineTargetBasedOnCoinAge(this.wallet.getCoinAgeOfWalletOnChain(this));
        this.log(`Will use target difficulty of ${20-Math.min(4, Math.floor(this.wallet.getCoinAgeOfWalletOnChain(this)))}`);
        // Spend all miners balance on coin-age transaction
        // Will get all back, no fee. It is just to spend the coin-age.
        let {inputs, totalSpent} = this.wallet.spendUTXOsFully(this.wallet.balanceOnChain(this), this);
        if(totalSpent === 0) throw new Error("Miner not able to spend any coinage.. can't mine");
        let coinageTX = this.currentBlock.spendCoinAge(selfAddr, totalSpent, inputs);
        this.wallet.addUTXO(coinageTX.outputs[0], coinageTX.id, 0);
        this.wallet.saveEligibilityProof(this.currentBlock);
      }

    if(isEligibileToMint(this, this.currentBlock, this.mint_elegibility_diff_dyn)) {
      this.log("Eligible to mint.");
      
      this.shouldMine = true;
    }
    else {
      this.shouldMine = false;
      this.log(`-Unable to mint this block. Will try again in ${TIME_UNTIL_ELIGIBILITY_DECREASE/1000} seconds.`);
      this.mint_elegibility_diff_dyn--;
      this.mintingTimeout = setTimeout(() => this.emit(INIT_MINTING, reuseRewardAddress), TIME_UNTIL_ELIGIBILITY_DECREASE);
    }
    
  }

  

  /**
   * Looks for a "proof".  It breaks after some time to listen for messages.  (We need
   * to do this since JS does not support concurrency).
   * 
   * The 'oneAndDone' field is used
   * for testing only; it prevents the findProof method from looking for the proof again
   * after the first attempt.
   * 
   * @param {boolean} oneAndDone - Give up after the first PoW search (testing only).
   */
  findProof(oneAndDone=false) {
    let pausePoint = this.currentBlock.proof + NUM_ROUNDS_MINING;
    while (this.shouldMine && this.currentBlock.proof < pausePoint) {

      if(this.isValidBlock(this.currentBlock)) {
        this.log("\x1b[32mFound proof. Starting new block.\x1b[0m");
        this.receiveOutput(this.currentBlock.coinbaseTX);
        this.announceProof();
        this.shouldMine = false;
        this.shouldStartNewBlock = true;
        this.startNewSearch();
        break;
      }

      this.currentBlock.proof++;
    }
    // If we are testing, don't continue the search.
    if (!oneAndDone) {
      // Check if anyone has found a block, and then return to mining.
      setTimeout(() => this.emit(START_MINING), 0);
    }
  }

  /**
   * Broadcast the block, with a valid proof included.
   */
  announceProof() {
    let serialized = this.currentBlock.serialize(true);
    this.broadcast(PROOF_FOUND, {block: serialized, miner: this});
  }

  /**
   * Verifies if a blocks proof is valid and all of its
   * transactions are valid.
   * 
   * @param {Block} b - The new block to be verified.
   */
  isValidBlock(b, miner = null) {
    if(miner !== null) {
     
      let currentTime = Date.now();
      //Checking for minting elegibiity based on timestamp
      //TODO: Need to validate that the blocks timestamp is not tampered with
      let blockTimestamp = b.timestamp;

      let diff = currentTime - blockTimestamp + 100; //allow for 100 ms error
      let minMintingDifficulty = MINT_ELEGIBILITY_DIFFICULTY - Math.floor(diff/TIME_UNTIL_ELIGIBILITY_DECREASE);

      if(!isEligibileToMint(miner, b, minMintingDifficulty)) {
        this.log(`\x1b[41m Miner ${miner.name} is not allowed to mint at this time!\x1b[0m`);
        throw new Error("invalid proof. Miner is not allowed to mint");
      }
    }
    // FIXME: Should verify that a block chains back to a previously accepted block.
    if (!b.verifyProof()) {
      return false;
    }
    return true;
  }

  /**
   * Receives a block from another miner. If it is valid,
   * the block will be stored. If it is also a longer chain,
   * the miner will accept it and replace the currentBlock.
   * 
   * @param {string} s - The block in serialized form.
   */
  receiveBlock({block: s, miner}) {
    let b = Block.deserialize(s);

    // FIXME: should not rely on the other block for the utxos.
    if (!this.isValidBlock(b, miner)) {
      this.log(`Rejecting invalid block!`);
      return false;
    }

    // If we don't have it, we store it in case we need it later.
    if (!this.previousBlocks[b.hashVal()]) {
      this.previousBlocks[b.hashVal()] = b;
    }

    // We switch over to the new chain only if it is better.
    if (b.chainLength >= this.currentBlock.chainLength && this !== miner) {
      this.log(`Cutting over to new chain.`);
      this.currentBlock = b;
      this.shouldStartNewBlock = true;
      this.startNewSearch(true);
    }
  }

  /**
   * Returns false if transaction is not accepted. Otherwise adds
   * the transaction to the current block.
   * 
   * @param {Transaction} tx - The transaction to add.
   */
  addTransaction(tx) {
    if (!this.currentBlock.willAcceptTransaction(tx)) {
      return false;
    }
    // FIXME: Toss out duplicate transactions, but store pending transactions.
    this.currentBlock.addTransaction(tx);
    return true;
  }

  /**
   * Like console.log, but includes the miner's name to make debugging easier.
   * 
   * @param {String} msg - The message to display to the console.
   */
  log(msg) {
    console.log(`${this.name}: ${msg}`);
  }
}

function text2Binary(string) {
  return string.split('').map(function (char) {
      return char.charCodeAt(0).toString(2);
  }).join('').slice(0, 16);//we don't need all of the bits to check. 16 is plenty
}

function countMatchingBits(string1, string2) {
  if(string1.length !== string2.length) throw new Error("Mismatching string length in mint elegibility process");
  let total = 0;
  for(let i = 0; i < string1.length; i++) {
    if(string1[i] === string2[i]) {
      total++;
    }
    else return total;
  }
  return total;
}

function isEligibileToMint(miner, b, target) {
  let cbh = text2Binary(b.prevBlockHash);
  let pkh = text2Binary(miner.wallet.getEligibilityAddress());
  return countMatchingBits(cbh, pkh) >= target;
}