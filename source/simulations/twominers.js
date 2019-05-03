"use strict";

let Block = require('../block.js');
let Client = require('../client.js');
let Miner = require('../miner.js');

let fakeNet = require('../fakeNet.js');

// Clients
//let alice = new Client(fakeNet.broadcast);
//let bob = new Client(fakeNet.broadcast);
//let charlie = new Client(fakeNet.broadcast);

// Miners
let minnie = new Miner("Minnie", fakeNet.broadcast);
let tom = new Miner(" Tom", fakeNet.broadcast);
let jerry = new Miner(" Jerry", fakeNet.broadcast);
let sam = new Miner(" Sam", fakeNet.broadcast);

console.log("Starting simulation.  This may take a moment...");

let genesis = Block.makeGenesisBlock([
  //{ client: alice, amount: 133},
  //{ client: bob, amount: 99},
  //{ client: charlie, amount: 67},
  { client: minnie, amount: 5},
  { client: tom, amount: 50},
  { client: jerry, amount: 500},
  { client: sam, amount: 5000},
]);

console.log("Initial balances:");
//console.log(`Alice has ${alice.wallet.balance} coins.`);
//console.log(`Bob has ${bob.wallet.balance} coins.`);
//console.log(`Charlie has ${charlie.wallet.balance} coins.`);
console.log(`Minnie has ${minnie.wallet.balance} coins.`);
console.log(`Tom has ${tom.wallet.balance} coins.`);
console.log(`Jerry has ${jerry.wallet.balance} coins.`);
console.log(`Sam has ${sam.wallet.balance} coins.`);
console.log();

fakeNet.register(/*alice, bob, charlie,*/ minnie, tom, jerry, sam);

// Miners start mining.
minnie.initialize(genesis);
tom.initialize(genesis);
jerry.initialize(genesis);
sam.initialize(genesis);

/*// Alice transfers some money to Bob.
let bobAddr = bob.wallet.makeAddress();
console.log(`Alice is transfering 40 coins to ${bobAddr}`);
alice.postTransaction([{ amount: 40, address: bobAddr }]);
*/
// Print out the final balances after it has been running for some time.
setTimeout(() => {
  console.log();
  console.log(`Minnie has a chain of length ${minnie.currentBlock.chainLength}, with the following UTXOs:`);
  minnie.currentBlock.displayUTXOs();

  console.log();
  console.log("Final wallets:");
  console.log(`Tom has ${tom.wallet.balanceOnChain(minnie)} coins.`);
  console.log(`Jerry has ${jerry.wallet.balanceOnChain(minnie)} coins.`);
  console.log(`Sam has ${sam.wallet.balanceOnChain(minnie)} coins.`);
  console.log(`Minnie has ${minnie.wallet.balanceOnChain(minnie)} coins.`);
  process.exit(0);
}, 10*60000); //10 minutes

