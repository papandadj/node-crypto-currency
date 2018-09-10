const _ = require('lodash');
const { validateTransaction } = require('./transaction');

let transactionPool = [];

function getTransactionPool() {
  return _.cloneDeep(transactionPool);
}

/**
 * 将交易添加到未确认交易池
 * @param {*} tx 
 * @param {*} unspentTxOuts 
 */
function addToTransactionPool(tx, unspentTxOuts) {

  if (!validateTransaction(tx, unspentTxOuts)) {
    throw Error('Trying to add invalid tx to pool');
  }

  if (!isValidTxForPool(tx, transactionPool)) {
    throw Error('Trying to add invalid tx to pool');
  }
  console.log('adding to txPool: %s', JSON.stringify(tx));
  transactionPool.push(tx);
}

/**
 * 判断交易是否还在未花费交易里面
 * @param {*} txIn 
 * @param {*} unspentTxOuts 
 */
function hasTxIn(txIn, unspentTxOuts) {
  const foundTxIn = unspentTxOuts.find((uTxO) => {
    return uTxO.txOutId === txIn.txOutId && uTxO.txOutIndex === txIn.txOutIndex;
  });
  return foundTxIn !== undefined;
}

/**
 * 更新交易池
 * - 如果交易被旷工挖了
 * - 有未交易的输出指向了其他的交易
 * 先查看未花费交易是否还在， 如果不在了， 则代表该交易已经进入到区块链里面
 * 及时删除交易池里面的数据
 * @param {} unspentTxOuts 
 */
function updateTransactionPool(unspentTxOuts) {
  const invalidTxs = [];
  for (const tx of transactionPool) {
    for (const txIn of tx.txIns) {
      if (!hasTxIn(txIn, unspentTxOuts)) {
        invalidTxs.push(tx);
        break;
      }
    }
  }
  if (invalidTxs.length > 0) {
    console.log('removing the following transactions from txPool: %s', JSON.stringify(invalidTxs));
    transactionPool = _.without(transactionPool, ...invalidTxs);
  }
}

/**
 * 获取交易池的全部输入
 * @param {Transaction[]} aTransactionPool 
 * @return {TxIn[]} 
 */
function getTxPoolIns(aTransactionPool) {
  return _(aTransactionPool)
    .map((tx) => tx.txIns)
    .flatten()
    .value();
}

/**
 * 查看交易是否合法， 有没有使用过， 避免双花
 * @param {Transaction[]} tx 
 * @param {} aTtransactionPool 
 */
function isValidTxForPool(tx, aTtransactionPool) {
  const txPoolIns = getTxPoolIns(aTtransactionPool);


  //当前交易的输入是已经在交易池里
  function containsTxIn(txIns, txIn) {
    return _.find(txPoolIns, ((txPoolIn) => {
      return txIn.txOutIndex === txPoolIn.txOutIndex && txIn.txOutId === txPoolIn.txOutId;
    }));
  }

  for (const txIn of tx.txIns) {
    if (containsTxIn(txPoolIns, txIn)) {
      console.log('txIn already found in the txPool');
      return false;
    }
  }
  return true;
}

module.exports = { addToTransactionPool, getTransactionPool, updateTransactionPool };