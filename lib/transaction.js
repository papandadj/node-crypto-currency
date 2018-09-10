const CryptoJS = require('crypto-js');
const ecdsa = require('elliptic');
const _ = require('lodash');

const ec = new ecdsa.ec('secp256k1');

const COINBASE_AMOUNT = 50;


/**
 * 未花费的交易输出结构
 * @param {string} txOutId 未花费的交易Id
 * @param {number} txOutIndex 
 * @param {string} address 该交易的输出地址， 也就是该货币的拥有者
 * @param {number} amount 该交易涉及的金额
 */
function UnspentTxOut(txOutId, txOutIndex, address, amount) {
  this.txOutId = txOutId;
  this.txOutIndex = txOutIndex;
  this.address = address;
  this.amount = amount;
}


/**
 * 交易输入格式
 * @param {string} txOutId 
 * @param {string} txOutIndex 
 * @param {string} signature 
 */
function TxIn(txOutId, txOutIndex, signature) {
  this.txOutId = txOutId;
  this.txOutIndex = txOutIndex;
  this.signature = signature;
}


/**
 * 交易的输出结构
 * @param {string} address 
 * @param {number} amount 
 */
function TxOut(address, amount) {
  this.address = address;
  this.amount = amount;
}

/**
 * 交易结构体
 * @param {string} id 
 * @param {TxIn[]} txIns 交易输入
 * @param {TxOut[]} txOuts 交易输出
 */
function Transaction(id, txIns, txOuts) {
  this.id = id;
  this.txIns = txIns;
  this.txOuts = txOuts;
}


/**
 * 计算交易id， 注意交易计算的交易 id不包括 TxIn的 signature
 * @param {object} transaction 一条交易
 * @return {string} 交易 hash既 id
 */
function getTransactionId(transaction) {
  const txInContent = transaction.txIns
    .map((txIn) => txIn.txOutId + txIn.txOutIndex)
    .reduce((a, b) => a + b, '');

  const txOutContent = transaction.txOuts
    .map((txOut) => txOut.address + txOut.amount)
    .reduce((a, b) => a + b, '');

  return CryptoJS.SHA256(txInContent + txOutContent).toString();
}

/**
 * 验证交易数据是否正确
 * @param {Transaction} transaction 
 * @param {UnspentTxOut[]} aUnspentTxOuts 
 */
function validateTransaction (transaction, aUnspentTxOuts)  {

  if (!isValidTransactionStructure(transaction)) {
    return false;
  }

  //验证id是否相同
  if (getTransactionId(transaction) !== transaction.id) {
    console.log('invalid tx id: ' + transaction.id);
    return false;
  }

  //验证交易数据是否正确
  const hasValidTxIns = transaction.txIns
    .map((txIn) => validateTxIn(txIn, transaction, aUnspentTxOuts))
    .reduce((a, b) => a && b, true);

  if (!hasValidTxIns) {
    console.log('some of the txIns are invalid in tx: ' + transaction.id);
    return false;
  }

  //计算交易输入金额
  const totalTxInValues = transaction.txIns
    .map((txIn) => getTxInAmount(txIn, aUnspentTxOuts))
    .reduce((a, b) => (a + b), 0);

  //计算交易输出金额
  const totalTxOutValues = transaction.txOuts
    .map((txOut) => txOut.amount)
    .reduce((a, b) => (a + b), 0);

  //判断输入是不是等于输出
  if (totalTxOutValues !== totalTxInValues) {
    console.log('totalTxOutValues !== totalTxInValues in tx: ' + transaction.id);
    return false;
  }

  return true;
};

/**
 * 验证区块是否正确
 * @param {Transaction[]} aTransactions 区块中的全部交易
 * @param {UnspentTxOut[]} aUnspentTxOuts
 * @param {number} blockIndex 区块索引
 * @return {boolean} 
 */
function validateBlockTransactions(aTransactions, aUnspentTxOuts, blockIndex) {

  //验证coinbase, 第一个区块是否正确
  const coinbaseTx = aTransactions[0];
  if (!validateCoinbaseTx(coinbaseTx, blockIndex)) {
    console.log('invalid coinbase transaction: ' + JSON.stringify(coinbaseTx));
    return false;
  }

  //检测是否有重复的交易输入， 如果有返回错误
  const txIns = _(aTransactions)
    .map(tx => tx.txIns)
    .flatten()
    .value();

  if (hasDuplicates(txIns)) {
    return false;
  }

  // 验证除了 coinbase的全部交易
  const normalTransactions = aTransactions.slice(1);
  return normalTransactions.map((tx) => validateTransaction(tx, aUnspentTxOuts))
    .reduce((a, b) => (a && b), true);

}

/**
 *检测是否有重复的交易输入 
 * @param {TxIn[]} txIns 
 * @return {boolean}
 */
function hasDuplicates(txIns) {
  const groups = _.countBy(txIns, (txIn) => txIn.txOutId + txIn.txOutId);
  return _(groups)
    .map((value, key) => {
      if (value > 1) {
        console.log('duplicate txIn: ' + key);
        return true;
      } else {
        return false;
      }
    })
    .includes(true);
}

/**
 * 
 * @param {*} transaction 
 * @param {number} blockIndex 
 */
function validateCoinbaseTx(transaction, blockIndex) {
  if (transaction === null) {
    console.log('the first transaction in the block must be coinbase transaction');
    return false;
  }
  if (getTransactionId(transaction) !== transaction.id) {
    console.log('invalid coinbase tx id: ' + transaction.id);
    return false;
  }
  if (transaction.txIns.length !== 1) {
    console.log('one txIn must be specified in the coinbase transaction');
    return;
  }
  if (transaction.txIns[0].txOutIndex !== blockIndex) {
    console.log('the txIn signature in coinbase tx must be the block height');
    return false;
  }
  if (transaction.txOuts.length !== 1) {
    console.log('invalid number of txOuts in coinbase transaction');
    return false;
  }
  if (transaction.txOuts[0].amount !== COINBASE_AMOUNT) {
    console.log('invalid coinbase amount in coinbase transaction');
    return false;
  }
  return true;
}

/**
 * 验证交易的输入是否正确
 * @param {*} txIn 
 * @param {*} transaction 
 * @param {*} aUnspentTxOuts 
 * @return {boolean}
 */
function validateTxIn(txIn, transaction, aUnspentTxOuts) {

  //该交易是否是在未花费列表里， 返回未花费交易
  const referencedUTxOut = aUnspentTxOuts.find((uTxO) => uTxO.txOutId === txIn.txOutId && uTxO.txOutId === txIn.txOutId);
  if (referencedUTxOut === null) {
    console.log('referenced txOut not found: ' + JSON.stringify(txIn));
    return false;
  }
  const address = referencedUTxOut.address;

  //查看未花费的公钥(既有使用权限)是否有使用权限
  const key = ec.keyFromPublic(address, 'hex');
  const validSignature = key.verify(transaction.id, txIn.signature);
  if (!validSignature) {
      console.log('invalid txIn signature: %s txId: %s address: %s', txIn.signature, transaction.id, referencedUTxOut.address);
      return false;
  }
  return true;
}

/**
 * 获取输入的价格
 * @param {*} txIn 一条交易
 * @param {*} aUnspentTxOuts 
 * @return {number}
 */
function getTxInAmount(txIn, aUnspentTxOuts) {
  return findUnspentTxOut(txIn.txOutId, txIn.txOutIndex, aUnspentTxOuts).amount;
}



/**
 * 找到符合的未花费交易
 * @param {string} transactionId 
 * @param {number} index 
 * @param {UnspentTxOut[]} aUnspentTxOuts 
 * @return {UnspentTxOut} 
 */
function findUnspentTxOut(transactionId, index, aUnspentTxOuts) {
  return aUnspentTxOuts.find((uTxO) => uTxO.txOutId === transactionId && uTxO.txOutIndex === index);
}

/**
 * 获取 coinbase的交易
 * @param {string} address 
 * @param {number} blockIndex 
 * @return {object} 
 */
function getCoinbaseTransaction(address, blockIndex) {
  const t = new Transaction('','','');
  const txIn = new TxIn('','','');
  txIn.signature = '';
  txIn.txOutId = '';
  txIn.txOutIndex = blockIndex;

  t.txIns = [txIn];
  t.txOuts = [new TxOut(address, COINBASE_AMOUNT)];
  t.id = getTransactionId(t);
  return t;
}

/**
 * 交易输入签名
 * @param {object} transaction 单个交易
 * @param {number} txInIndex 
 * @param {string} privateKey 适合交易输入的私钥
 * @param {UnspentTxOut[]} aUnspentTxOuts 
 * @return {signature} 签名
 */
const signTxIn = (transaction, txInIndex, privateKey, aUnspentTxOuts) => {
  const txIn = transaction.txIns[txInIndex];

  const dataToSign = transaction.id;
  const referencedUnspentTxOut = findUnspentTxOut(txIn.txOutId, txIn.txOutIndex, aUnspentTxOuts);
  if (referencedUnspentTxOut === null) {
    console.log('could not find referenced txOut');
    throw Error();
  }
  const referencedAddress = referencedUnspentTxOut.address;

  if (getPublicKey(privateKey) !== referencedAddress) {
    console.log('trying to sign an input with private' +
      ' key that does not match the address that is referenced in txIn');
    throw Error();
  }
  const key = ec.keyFromPrivate(privateKey, 'hex');
  const signature = toHexString(key.sign(dataToSign).toDER());

  return signature;
};


/**
 * 每次有新的交易产生时需要更新未花费交易数据。
 * @param {Transactions[]} newTransactions 新产生的交易
 * @param {UnspentTxOut[]} aUnspentTxOuts 
 * @return {UnspentTxOut[]} 
 */
function updateUnspentTxOuts(newTransactions, aUnspentTxOuts) {

  //根据传来的交易判断有哪些新的未花费交易产生
  const newUnspentTxOuts = newTransactions
    .map((t) => {
      return t.txOuts.map((txOut, index) => new UnspentTxOut(t.id, index, txOut.address, txOut.amount));
    })
    .reduce((a, b) => a.concat(b), []);

  //根据传来的交易判断有哪些未花费的交易被使用
  const consumedTxOuts = newTransactions
    .map((t) => t.txIns)
    .reduce((a, b) => a.concat(b), [])
    .map((txIn) => new UnspentTxOut(txIn.txOutId, txIn.txOutIndex, '', 0));

  //将未花费交易数据删除已经花费的， 添加新产生的
  const resultingUnspentTxOuts = aUnspentTxOuts
    .filter(((uTxO) => !findUnspentTxOut(uTxO.txOutId, uTxO.txOutIndex, consumedTxOuts)))
    .concat(newUnspentTxOuts);

  return resultingUnspentTxOuts;
}


function processTransactions(aTransactions, aUnspentTxOuts, blockIndex) {

  if (!validateBlockTransactions(aTransactions, aUnspentTxOuts, blockIndex)) {
    console.log('invalid block transactions');
    return null;
  }
  return updateUnspentTxOuts(aTransactions, aUnspentTxOuts);
}

function toHexString(byteArray) {
  return Array.from(byteArray, function (byte) {
    return ('0' + (byte & 0xFF).toString(16)).slice(-2);
  }).join('');
}

function getPublicKey(aPrivateKey) {
  return ec.keyFromPrivate(aPrivateKey, 'hex').getPublic().encode('hex');
}


function isValidTxInStructure(txIn) {
  if (txIn === null) {
    console.log('txIn is null');
    return false;
  } else if (typeof txIn.signature !== 'string') {
    console.log('invalid signature type in txIn');
    return false;
  } else if (typeof txIn.txOutId !== 'string') {
    console.log('invalid txOutId type in txIn');
    return false;
  } else if (typeof txIn.txOutIndex !== 'number') {
    console.log('invalid txOutIndex type in txIn');
    return false;
  } else {
    return true;
  }
}

function isValidTxOutStructure(txOut) {
  if (txOut === null) {
    console.log('txOut is null');
    return false;
  } else if (typeof txOut.address !== 'string') {
    console.log('invalid address type in txOut');
    return false;
  } else if (!isValidAddress(txOut.address)) {
    console.log('invalid TxOut address');
    return false;
  } else if (typeof txOut.amount !== 'number') {
    console.log('invalid amount type in txOut');
    return false;
  } else {
    return true;
  }
}

/**
 * 
 * @param {Tranction[]} transactions 
 * @return {boolean}
 */
// function isValidTransactionsStructure (transactions) {
//   console.log(transactions);
//   return transactions
//     .map(isValidTransactionStructure)
//     .reduce((a, b) => (a && b), true);
// }

/**
 * 判断交易是结构类型是否正确
 * @param {Transaction} transaction 
 */
function isValidTransactionStructure(transaction) {
  if (typeof transaction.id !== 'string') {
    console.log('transactionId missing');
    return false;
  }
  if (!(transaction.txIns instanceof Array)) {
    console.log('invalid txIns type in transaction');
    return false;
  }
  if (!transaction.txIns
    .map(isValidTxInStructure)
    .reduce((a, b) => (a && b), true)) {
    return false;
  }

  if (!(transaction.txOuts instanceof Array)) {
    console.log('invalid txIns type in transaction');
    return false;
  }

  if (!transaction.txOuts
    .map(isValidTxOutStructure)
    .reduce((a, b) => (a && b), true)) {
    return false;
  }
  return true;
}

//地址必须是 ecdsa公钥格式
function isValidAddress(address) {
  if (address.length !== 130) {
    console.log('invalid public key length');
    return false;
  } else if (address.match('^[a-fA-F0-9]+$') === null) {
    console.log('public key must contain only hex characters');
    return false;
  } else if (!address.startsWith('04')) {
    console.log('public key must start with 04');
    return false;
  }
  return true;
}

module.exports = {
  processTransactions, signTxIn, getTransactionId, isValidAddress, validateTransaction,
  UnspentTxOut, TxIn, TxOut, getCoinbaseTransaction, getPublicKey, hasDuplicates,
  Transaction
};