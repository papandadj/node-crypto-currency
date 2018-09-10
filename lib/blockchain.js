const CryptoJS = require('crypto-js');
const _ = require('lodash');

module.exports = { BlockStructure, getBlockchain, getUnspentTxOuts, getLatestBlock, sendTransaction,
  generateRawNextBlock, generateNextBlock, generatenextBlockWithTransaction,
  handleReceivedTransaction, getMyUnspentTransactionOutputs,
  getAccountBalance, isValidBlockStructure, replaceChain, addBlockToChain
};

const { broadcastLatest, broadCastTransactionPool } = require('./p2p');
const {
  getCoinbaseTransaction, isValidAddress, processTransactions,
} = require('./transaction');
const { addToTransactionPool, getTransactionPool, updateTransactionPool } = require('./transactionPool');
const { hexToBinary } = require('./util');
const { createTransaction, findUnspentTxOuts, getBalance, getPrivateFromWallet, getPublicFromWallet } = require('./wallet');


/**
 * 
 * 区块结构体定义
 * @param {number} index 
 * @param {string} hash 
 * @param {string} previousHash 
 * @param {number} timestamp 
 * @param {string} data 
 * @return {object} 区块结构体
 */
function BlockStructure(index, hash, previousHash, timestamp, data, difficulty, nonce) {
  this.index = index;
  this.hash = hash;
  this.previousHash = previousHash;
  this.data = data;
  this.timestamp = timestamp;
  this.difficulty = difficulty;
  this.nonce = nonce;

}

//创世区块的data
const genesisTransaction = {
  'txIns': [{ 'signature': '', 'txOutId': '', 'txOutIndex': 0 }],
  'txOuts': [{
    'address': '04bfcab8722991ae774db48f934ca79cfb7dd991229153b9f732ba5334aafcd8e7266e47076996b55a14bf9913ee3145ce0cfc1372ada8ada74bd287450313534a',
    'amount': 50
  }],
  'id': 'e655f6a5f26dc9b4cac6e46f52336428287759cf81ef5ff10854f69d68f43fa3'
};

/**
 * 生成创世区块
 * @return block实例
 */
function genesisBlock() {
  return new BlockStructure(0, '91a73664bc84c0baa1fc75ea6e4aa6d1d20c5df664c724e3159aefc2e1186627', '', 1465154705, [genesisTransaction], 0, 0);
}

/**
 * 生成第一个区块链
 */
let blockchain = [genesisBlock()];

// 未花费交易输出列表 @unspentTxOuts {UnspentTxOut[]}
let unspentTxOuts = processTransactions(blockchain[0].data, [], 0);

/**
 * 获取区块链
 * @return {BlockStructure[]}
 */
function getBlockchain() {
  return blockchain;
}

//获取未花费交易输出列表 @return {UnspentTxOut[]}
function getUnspentTxOuts() {
  return _.cloneDeep(unspentTxOuts);
}

// 更新交易池信息
function setUnspentTxOuts(newUnspentTxOut) {
  console.log('replacing unspentTxouts with: %s', newUnspentTxOut);
  unspentTxOuts = newUnspentTxOut;
}

/**
 * 获取最新的区块
 * @return {BlockStructure}
 */
function getLatestBlock() {
  return blockchain[blockchain.length - 1];
}

// 平均每10秒挖一个区块
const BLOCK_GENERATION_INTERVAL = 10;

// 每10个块调整一次
const DIFFICULTY_ADJUSTMENT_INTERVAL = 10;

/**
 * 计算下一个区块的难度值
 * @param {BlockStructure[]} aBlockchain 
 * @return {number}
 */
function getDifficulty(aBlockchain) {
  const latestBlock = aBlockchain[blockchain.length - 1];
  if (latestBlock.index % DIFFICULTY_ADJUSTMENT_INTERVAL === 0 && latestBlock.index !== 0) {
    return getAdjustedDifficulty(latestBlock, aBlockchain);
  } else {
    return latestBlock.difficulty;
  }
}

/**
 * 调整区块难度值， 
 * @param {BlockStructure} latestBlock 最后一个区块
 * @param {BlockStructure[]} aBlockchain 全部区块
 * @return {number}
 */
function getAdjustedDifficulty(latestBlock, aBlockchain) {
  const prevAdjustmentBlock = aBlockchain[blockchain.length - DIFFICULTY_ADJUSTMENT_INTERVAL];
  const timeExpected = BLOCK_GENERATION_INTERVAL * DIFFICULTY_ADJUSTMENT_INTERVAL;
  const timeTaken = latestBlock.timestamp - prevAdjustmentBlock.timestamp;
  if (timeTaken < timeExpected / 2) {
    return prevAdjustmentBlock.difficulty + 1;
  } else if (timeTaken > timeExpected * 2) {
    return prevAdjustmentBlock.difficulty - 1;
  } else {
    return prevAdjustmentBlock.difficulty;
  }
}

//获取时间戳
function getCurrentTimestamp() {
  return Math.round(new Date().getTime() / 1000);
}

/**
 * 生产区块, 挖矿
 * @param {Transaction[]} blockData 
 */
function generateRawNextBlock(blockData) {
  const previousBlock = getLatestBlock();
  const difficulty = getDifficulty(getBlockchain());
  const nextIndex = previousBlock.index + 1;
  const nextTimestamp = getCurrentTimestamp();
  const newBlock = findBlock(nextIndex, previousBlock.hash, nextTimestamp, blockData, difficulty);
  if (addBlockToChain(newBlock)) {
    broadcastLatest();
    return newBlock;
  } else {
    return null;
  }
}

/**
 * 根据公钥获取自己的未花费输出列表
 */
function getMyUnspentTransactionOutputs() {
  return findUnspentTxOuts(getPublicFromWallet(), getUnspentTxOuts());
}


/**
 * 创建下一个区块
 * @param {string} blockData 
 * @return {BlockStructure} 区块实例
 */
function generateNextBlock() {
  const coinbaseTx = getCoinbaseTransaction(getPublicFromWallet(), getLatestBlock().index + 1);
  const blockData = [coinbaseTx].concat(getTransactionPool());
  return generateRawNextBlock(blockData);
}

/**
 * 生成一条交易并且计算区块
 * @param {*} receiverAddress 
 * @param {*} amount 
 */
function generatenextBlockWithTransaction(receiverAddress, amount) {
  if (!isValidAddress(receiverAddress)) {
    throw Error('invalid address');
  }
  if (typeof amount !== 'number') {
    throw Error('invalid amount');
  }
  const coinbaseTx = getCoinbaseTransaction(getPublicFromWallet(), getLatestBlock().index + 1);
  const tx = createTransaction(receiverAddress, amount, getPrivateFromWallet(), getUnspentTxOuts(), getTransactionPool());
  const blockData = [coinbaseTx, tx];
  return generateRawNextBlock(blockData);
}

//计算区块
function findBlock(index, previousHash, timestamp, data, difficulty) {
  let nonce = 0;
  while (true) {
    const hash = calculateHash(index, previousHash, timestamp, data, difficulty, nonce);
    if (hashMatchesDifficulty(hash, difficulty)) {
      return new BlockStructure(index, hash, previousHash, timestamp, data, difficulty, nonce);
    }
    nonce++;
  }
}

//获取钱包钱数
function getAccountBalance() {
  return getBalance(getPublicFromWallet(), getUnspentTxOuts());
}

//发送交易
function sendTransaction(address, amount) {
  const tx = createTransaction(address, amount, getPrivateFromWallet(), getUnspentTxOuts(), getTransactionPool());
  addToTransactionPool(tx, getUnspentTxOuts());
  broadCastTransactionPool();
  return tx;
}

/**
 * 计算块的hash
 * @param {BlockStructure} block 区块
 * @return {string} hash值
 */
function calculateHashForBlock(block) {
  return calculateHash(block.index, block.previousHash, block.timestamp, block.data, block.difficulty, block.nonce);
}

/**
 * 计算hash
 * @param {number} index 
 * @param {string} previousHash 
 * @param {number} timestamp 
 * @param {string} data 
 * @return {string} 计算参数的hash值
 */
function calculateHash(index, previousHash, timestamp, data, difficulty, nonce) {
  return CryptoJS.SHA256(index + previousHash + timestamp + data + difficulty + nonce).toString();
}

/**
 * 验证区块类型是否正确
 * @param {BlockStructure} block 
 * @return {boolean} 
 */
function isValidBlockStructure(block) {
  return typeof block.index === 'number' &&
    typeof block.hash === 'string' &&
    typeof block.previousHash === 'string' &&
    typeof block.timestamp === 'number' &&
    typeof block.data === 'object';
}


/**
 * 验证区块
 * @param {BlockStructure} newBlock 
 * @param {BlockStructure} previousBlock 
 * @return {boolean} 
 */
function isValidNewBlock(newBlock, previousBlock) {
  if (!isValidBlockStructure(newBlock)) {
    console.log('invalid structure');
    return false;
  }

  if (previousBlock.index + 1 !== newBlock.index) {
    console.log('invalid index');
    return false;
  } else if (previousBlock.hash !== newBlock.previousHash) {
    console.log('invalid previous hash');
    return false;
  } else if (!isValidTimestamp(newBlock, previousBlock)) {
    console.log('invalid timestamp');
    return false;
  } else if (!hasValidHash(newBlock)) {
    return false;
  }
  return true;
}


function getAccumulatedDifficulty(aBlockchain) {
  return aBlockchain
    .map((block) => block.difficulty)
    .map((difficulty) => Math.pow(2, difficulty))
    .reduce((a, b) => a + b);
}

//验证时间戳， 必须在一小时以内
function isValidTimestamp(newBlock, previousBlock) {
  return (previousBlock.timestamp - 60 < newBlock.timestamp) &&
    newBlock.timestamp - 60 < getCurrentTimestamp();
}

//查看区块hash是否正确
function hasValidHash(block) {

  if (!hashMatchesBlockContent(block)) {
    console.log('invalid hash, got:' + block.hash);
    return false;
  }

  if (!hashMatchesDifficulty(block.hash, block.difficulty)) {
    console.log('block difficulty not satisfied. Expected: ' + block.difficulty + 'got: ' + block.hash);
  }
  return true;
}

//验证区块的 hash是否正确
function hashMatchesBlockContent(block) {
  const blockHash = calculateHashForBlock(block);
  return blockHash === block.hash;
}

//验证 hash的难度值是否正确
function hashMatchesDifficulty(hash, difficulty) {
  const hashInBinary = hexToBinary(hash);
  const requiredPrefix = '0'.repeat(difficulty);
  return hashInBinary.startsWith(requiredPrefix);
}

/**
 * 验证区块链的正确性， 如果正确， 返回未交易花费输出
 * @param {BlockStructure[]} blockchainToValidate 
 * @return {boolean}
 */
function isValidChain(blockchainToValidate) {
  console.log('isValidChain:');
  console.log(JSON.stringify(blockchainToValidate));

  //验证创世区块
  function isValidGenesis(block) {
    return JSON.stringify(block) === JSON.stringify(genesisBlock);
  }

  if (!isValidGenesis(blockchainToValidate[0])) {
    return null;
  }

  /*
  Validate each block in the chain. The block is valid if the block structure is valid
    and the transaction are valid
   */
  let aUnspentTxOuts = [];

  for (let i = 0; i < blockchainToValidate.length; i++) {
    const currentBlock = blockchainToValidate[i];
    if (i !== 0 && !isValidNewBlock(blockchainToValidate[i], blockchainToValidate[i - 1])) {
      return null;
    }

    aUnspentTxOuts = processTransactions(currentBlock.data, aUnspentTxOuts, currentBlock.index);
    if (aUnspentTxOuts === null) {
      console.log('invalid transactions in blockchain');
      return null;
    }
  }
  return aUnspentTxOuts;
}


/**
 * 添加区块
 * @param {BlockStructure} newBlock 
 * @return {boolean} 是否添加成功
 */
function addBlockToChain(newBlock) {
  if (isValidNewBlock(newBlock, getLatestBlock())) {
    const retVal = processTransactions(newBlock.data, getUnspentTxOuts(), newBlock.index);
    if (retVal === null) {
      console.log('block is not valid in terms of transactions');
      return false;
    } else {
      blockchain.push(newBlock);
      setUnspentTxOuts(retVal);
      updateTransactionPool(unspentTxOuts);
      return true;
    }
  }
  return false;
}

/**
 * 根据计算的算力替换区块
 * @param {BlockStructure[]}} newBlocks
 */
function replaceChain(newBlocks) {
  const aUnspentTxOuts = isValidChain(newBlocks);
  const validChain = aUnspentTxOuts !== null;
  if (validChain &&
      getAccumulatedDifficulty(newBlocks) > getAccumulatedDifficulty(getBlockchain())) {
      console.log('Received blockchain is valid. Replacing current blockchain with received blockchain');
      blockchain = newBlocks;
      setUnspentTxOuts(aUnspentTxOuts);
      updateTransactionPool(unspentTxOuts);
      broadcastLatest();
  } else {
      console.log('Received blockchain invalid');
  }
}

function handleReceivedTransaction (transaction)  {
  addToTransactionPool(transaction, getUnspentTxOuts());
}

// module.exports = { BlockStructure, getBlockchain, getUnspentTxOuts, getLatestBlock, sendTransaction,
//   generateRawNextBlock, generateNextBlock, generatenextBlockWithTransaction,
//   handleReceivedTransaction, getMyUnspentTransactionOutputs,
//   getAccountBalance, isValidBlockStructure, replaceChain, addBlockToChain
// };