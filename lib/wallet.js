const Ec = require('elliptic').ec;
const { existsSync, readFileSync, unlinkSync, writeFileSync } = require('fs');
const _ = require('lodash');
const { getPublicKey, getTransactionId, signTxIn, Transaction, TxIn, TxOut } = require('./transaction');

const EC = new Ec('secp256k1');
const privateKeyLocation = process.env.PRIVATE_KEY || '../private_key';

/**
 * 从钱包获取私钥
 */
function getPrivateFromWallet() {
  const buffer = readFileSync(privateKeyLocation, 'utf8');
  return buffer.toString();
}


/**
 * 从钱包获取公钥
 */
function getPublicFromWallet() {
  const privateKey = getPrivateFromWallet();
  const key = EC.keyFromPrivate(privateKey, 'hex');
  return key.getPublic().encode('hex');
}

/**
 * 产生私钥
 */
function generatePrivateKey() {
  const keyPair = EC.genKeyPair();
  const privateKey = keyPair.getPrivate();
  return privateKey.toString(16);
}

//初始化钱包， 将私钥存入文件
function initWallet() {
  // 查看私钥文件是否存在
  if (existsSync(privateKeyLocation)) {
    return;
  }
  const newPrivateKey = generatePrivateKey();

  writeFileSync(privateKeyLocation, newPrivateKey);
  console.log('new wallet with private key created to : %s', privateKeyLocation);
}


function deleteWallet() {
  if (existsSync(privateKeyLocation)) {
    unlinkSync(privateKeyLocation);
  }
}


/**
 * 获取未花费交易输出
 * @param {string} ownerAddress 
 * @param {unspentTxOut[]} unspentTxOuts 
 * @return {unspentTxOut[]}
 */
function findUnspentTxOuts(ownerAddress, unspentTxOuts) {
  return _.filter(unspentTxOuts, (uTxO) => uTxO.address === ownerAddress);
}

/**
 * 获取钱包余额， 既未花费交易的总值
 * @param {string} address 公钥地址 
 * @param {unspentTxOut[]} unspentTxOuts 未花费列表
 * @return {number}
 */
function getBalance(address, unspentTxOuts) {
  return _(findUnspentTxOuts(address, unspentTxOuts))
    .map((uTxO) => uTxO.amount)
    .sum();
}

/**
 * 根据需要使用的钱数计算出要使用的相应的未花费交易， 如果交易的钱数大于实际的， 最后需要返回
 * @param {number} amount 
 * @param {unspentTxOut[]} myUnspentTxOuts 
 * @return {{object}includedUnspentTxOuts, {number}leftOverAmount} 相应的未交易花费， 最后应该给返回的钱
 */
function findTxOutsForAmount(amount, myUnspentTxOuts) {
  let currentAmount = 0;
  const includedUnspentTxOuts = [];
  for (const myUnspentTxOut of myUnspentTxOuts) {
    includedUnspentTxOuts.push(myUnspentTxOut);
    currentAmount = currentAmount + myUnspentTxOut.amount;
    if (currentAmount >= amount) {
      const leftOverAmount = currentAmount - amount;
      return { includedUnspentTxOuts, leftOverAmount };
    }
  }

  const eMsg = 'Cannot create transaction from the available unspent transaction outputs.' +
    ' Required amount:' + amount + '. Available unspentTxOuts:' + JSON.stringify(myUnspentTxOuts);
  throw Error(eMsg);
}


/**
 * 创建交易输出， 一部分给转入的地址， 剩余的给自己
 * @param {string} receiverAddress 转入地址
 * @param {string} myAddress 自己的地址
 * @param {number} amount 转入的金额
 * @param {number} leftOverAmount 剩余给你自己的金额
 * @return {TxOut[]}
 */
function createTxOuts(receiverAddress, myAddress, amount, leftOverAmount) {
  const txOut1 = new TxOut(receiverAddress, amount);
  if (leftOverAmount === 0) {
    return [txOut1];
  } else {
    const leftOverTx = new TxOut(myAddress, leftOverAmount);
    return [txOut1, leftOverTx];
  }
}


/**
 * 检测用户输入的交易有没有在交易池已经指定的
 * @param {UnspentTxOut[]} unspentTxOuts 用户全部未花费交易输出
 * @param {Transaction} transactionPool 交易池
 * @return {UnspentTxOut[]}
 */
function filterTxPoolTxs  (unspentTxOuts, transactionPool) {
  const txIns = _(transactionPool)
    .map((tx) => tx.txIns)
    .flatten()
    .value();

  const removable = [];

  for (const unspentTxOut of unspentTxOuts) {
    const txIn = _.find(txIns, function(aTxIn) {
      return aTxIn.txOutIndex === unspentTxOut.txOutIndex && aTxIn.txOutId === unspentTxOut.txOutId;
    });

    if (txIn === undefined) {

    } else {
      removable.push(unspentTxOut);
    }
  }

  return _.without(unspentTxOuts, ...removable);
}

/**
 * 
 * @param {string} receiverAddress 
 * @param {number} amount 
 * @param {string} privateKey 
 * @param {UnspentTxOut[]} unspentTxOuts 
 * @param {Transaction[]} txPool 
 */

function createTransaction(receiverAddress, amount, privateKey, unspentTxOuts, txPool) {

  console.log('txPool: %s', JSON.stringify(txPool));
  const myAddress = getPublicKey(privateKey);
  //获取我的全部未花费交易输出
  const myUnspentTxOutsA = unspentTxOuts.filter((uTxO) => uTxO.address === myAddress);

  const myUnspentTxOuts = filterTxPoolTxs(myUnspentTxOutsA, txPool);

  const { includedUnspentTxOuts, leftOverAmount } = findTxOutsForAmount(amount, myUnspentTxOuts);


  //返回未签名输入类型
  function toUnsignedTxIn (unspentTxOut){
    const txIn = new TxIn(unspentTxOut.txOutId, unspentTxOut.txOutIndex, '');
    return txIn;
  }
  //未签名输入集合
  const unsignedTxIns = includedUnspentTxOuts.map(toUnsignedTxIn);

  const tx = new Transaction('','','');

  tx.txIns = unsignedTxIns;
  tx.txOuts = createTxOuts(receiverAddress, myAddress, amount, leftOverAmount);
  tx.id = getTransactionId(tx);

  //对交易输入签名
  tx.txIns = tx.txIns.map((txIn, index) => {
    txIn.signature = signTxIn(tx, index, privateKey, unspentTxOuts);
    return txIn;
  });


  return tx;
}

module.exports = {
  createTransaction, getPublicFromWallet,
  getPrivateFromWallet, getBalance, generatePrivateKey, initWallet, deleteWallet, findUnspentTxOuts
};