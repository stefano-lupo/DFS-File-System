import crypto from 'crypto';
import moment from 'moment';
import express from 'express';
import mongoose from 'mongoose';
import Grid from 'gridfs-stream';
import multer from 'multer';
import GridFsStorage from 'multer-gridfs-storage';
import bodyParser from 'body-parser';
import morgan from 'morgan';
import fs from 'fs';
import path from 'path';


// Initialize .env
require('dotenv').config();


// Make encryption parameters accessible
const encryption = {
  algorithm: process.env.SYMMETRIC_ENCRYPTION,
  plainEncoding: process.env.PLAIN_ENCODING,
  encryptedEncoding: process.env.ENCRYPTED_ENCODING,
  serverKey: process.env.SERVER_KEY
};



// Import Controllers
import FileController from './controllers/FileController';


// Create Server
const app = express();
app.use(bodyParser.urlencoded({extended: true}));   // Parses application/x-www-form-urlencoded for req.body
app.use(bodyParser.json());                         // Parses application/json for req.body
app.use(morgan('dev'));


// Set some global constants to be used else where
const port = process.argv[2] || process.env.port || 3000;
const role = process.argv[3] || process.env.role || 'slave';
app.set('port', port);
app.set('ip', `http://localhost:${port}`);
app.set('role', role);


// Initialize the DB
const dbURL = `mongodb://localhost/dfs_filesystem_${port}`;
mongoose.connect(dbURL);
const db = mongoose.connection;
db.on('error', console.error.bind(console, 'connection error:'));
db.once('open', function() {

  // Handles Reading from GFS
  const gfs = Grid(db.db, mongoose.mongo);
  app.set('gfs', gfs);

  console.log("Connected to Database");
});


/****************************************************************************************************************
 * NOTES
 * This middleware should be declared AFTER auth middleware
 * The file must be posted LAST so that body is populated by the time this fires and can be used to build filename
 *****************************************************************************************************************/
// Handles Writing to GFS - Can skip uploading tmp file as can be written straight to GFS
const storage = new GridFsStorage({
  url: dbURL,
  file: (req, file) => {
    const { filename } = req.body;
    return {
      filename,
      metadata: {version: 0}

    }
  }
});
const upload = multer({storage});


// Ensure a folder exists for this ports tmp files
const dir = `${__dirname}/tmpUploads/${port}`;
console.log(`Saving files to ${dir}`);
app.set('dir', dir);
if(!fs.existsSync(dir)) {
  fs.mkdir(dir);
}


// Handles updating a GFS file - Need to query the DB to find the old meta data so needs intermediate tmp file
const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, dir)
  },
  filename: function (req, file, cb) {
    cb(null, `${req.params._id}_${Date.now()}`);
  }
});
const updater = multer({storage: diskStorage});


// Middleware to authenticate / decrypt incoming requests
const authenticator = (req, res, next) => {

  // Ensure auth ticket exists
  const { authorization } = req.headers;
  if(!authorization) {
    console.log(`No Auth key provided`);
    return res.status(401).send({message: `No authorization key provided`});
  }

  try {
    // Decrypt auth ticket with server's private key
    const ticket = decrypt(authorization);

    // Parse the ticket from the decrypted string
    let { _id, expires, sessionKey } = JSON.parse(ticket);
    expires = moment(expires);


    // Ensure the ticket is in date
    if(moment().isAfter(expires)) {
      console.log(`Ticket expired on ${expires.format()}`);
      return res.status(401).send({message: `Authorization token expired on ${expires.format()}`});
    }


    // Pass the controllers the decrypted body and the client's _id
    req.clientId = _id;
    if(req.body.encrypted) {
      req.decrypted = JSON.parse(decrypt(req.body.encrypted, sessionKey));
    }
  }

  // If JSON couldn't be parsed, the token was
  catch(err) {
    console.log(err);
    return res.status(401).send({message: `Invalid authorization key provided`})
  }

  next()
};

// Inter Service Endpoints
app.post('/slave/:_id', updater.single('file'), FileController.receiveUpdateFromMaster);


app.use(authenticator);


// Endpoints
app.get('/files', FileController.getFiles);
app.get('/file/:_id', FileController.getFile);
app.post('/file', upload.single('file'), FileController.uploadFile);
app.post('/file/:_id', updater.single('file'), FileController.updateFile);
app.delete('/file/:_id', FileController.deleteFile);



// Initialize the Server
app.listen(port, () => {
  console.log(`Listening on port ${port}`);
});



/**
 * Decrypts the data using parameters defined in .env file
 * @param data to be decrypted
 * @param key used during the encryption
 */
function decrypt(data, key=encryption.serverKey) {
  const { algorithm, plainEncoding, encryptedEncoding } = encryption;

  const decipher = crypto.createDecipher(algorithm, key);
  let deciphered = decipher.update(data, encryptedEncoding, plainEncoding);
  deciphered += decipher.final(plainEncoding);

  return deciphered
}

