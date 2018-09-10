const express = require('express');
const bodyParser = require('body-parser');
const _ = require('lodash');
const { generateNextBlock, generatenextBlockWithTransaction, generateRawNextBlock, getAccountBalance,
  getBlockchain, getMyUnspentTransactionOutputs, getUnspentTxOuts, sendTransaction } = require('./blockchain');
const { connectToPeers, getSockets, initP2PServer } = require('./p2p');
const { getTransactionPool } = require('./transactionPool');
const { getPublicFromWallet, initWallet } = require('./wallet');

const httpPort = 3001;
const p2pPort = 6001;

function initHttpServer(myHttpPort) {
  const app = express();
  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded());

  app.use((err, req, res, next) => {
    if (err) {
      res.status(400).send(err.message);
    }
  });

  //获取整个区块链
  app.get('/blocks', (req, res) => {
    res.send(getBlockchain());
  });

  //获取指定 hash的区块
  app.get('/block/:hash', (req, res) => {
    const block = _.find(getBlockchain(), { 'hash': req.params.hash });
    res.send(block);
  });

  //获取指定交易id交易
  app.get('/transaction/:id', (req, res) => {
    const tx = _(getBlockchain())
      .map((blocks) => blocks.data)
      .flatten()
      .find({ 'id': req.params.id });
    res.send(tx);
  });

  //获取公钥对应的全部未花费交易
  app.get('/address/:address', (req, res) => {
    function unspentTxOuts() {
      return _.filter(getUnspentTxOuts(), (uTxO) => uTxO.address === req.params.address);
    }
    res.send({ 'unspentTxOuts': unspentTxOuts });
  });

  //获取全部未花费交易输出
  app.get('/unspentTransactionOutputs', (req, res) => {
    res.send(getUnspentTxOuts());
  });

  //
  app.get('/myUnspentTransactionOutputs', (req, res) => {
    res.send(getMyUnspentTransactionOutputs());
  });

  //添加数据，开始挖矿
  app.post('/mineRawBlock', (req, res) => {
    if (req.body.data === null) {
      res.send('data parameter is missing');
      return;
    }
    const newBlock = generateRawNextBlock(req.body.data);
    if (newBlock === null) {
      res.status(400).send('could not generate block');
    } else {
      res.send(newBlock);
    }
  });

  //开始挖矿
  app.post('/mineBlock', (req, res) => {
    const newBlock = generateNextBlock();
    if (newBlock === null) {
      res.status(400).send('could not generate block');
    } else {
      res.send(newBlock);
    }
  });

  app.get('/balance', (req, res) => {
    const balance = getAccountBalance();
    res.send({ 'balance': balance });
  });

  app.get('/address', (req, res) => {
    const address = getPublicFromWallet();
    res.send({ 'address': address });
  });

  app.post('/mineTransaction', (req, res) => {
    const address = req.body.address;
    const amount = req.body.amount;
    try {
      const resp = generatenextBlockWithTransaction(address, amount);
      res.send(resp);
    } catch (e) {
      console.log(e.message);
      res.status(400).send(e.message);
    }
  });

  app.post('/sendTransaction', (req, res) => {
    try {
      const address = req.body.address;
      const amount = req.body.amount;

      if (address === undefined || amount === undefined) {
        throw Error('invalid address or amount');
      }
      const resp = sendTransaction(address, amount);
      res.send(resp);
    } catch (e) {
      console.log(e.message);
      res.status(400).send(e.message);
    }
  });

  app.get('/transactionPool', (req, res) => {
    res.send(getTransactionPool());
  });

  app.get('/peers', (req, res) => {
    res.send(getSockets().map((s) => s._socket.remoteAddress + ':' + s._socket.remotePort));
  });

  app.post('/addPeer', (req, res) => {
    connectToPeers(req.body.peer);
    res.send();
  });

  app.post('/stop', (req, res) => {
    res.send({ 'msg': 'stopping server' });
    process.exit();
  });

  app.listen(myHttpPort, () => {
    console.log('Listening http on port: ' + myHttpPort);
  });
}

initHttpServer(httpPort);
initP2PServer(p2pPort);
initWallet();