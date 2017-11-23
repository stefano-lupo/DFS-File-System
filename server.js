import express from 'express';
import mongoose from 'mongoose';
import Grid from 'gridfs-stream';
import multer from 'multer';
import GridFsStorage from 'multer-gridfs-storage';

import bodyParser from 'body-parser';
import morgan from 'morgan';
import jwt from 'jsonwebtoken';

// Import Controllers
import FileController from './controllers/FileController';

const app = express();

// Initialize .env
// require('dotenv').config();


// Initialize the DB
const dbURL = "mongodb://localhost/dfs_filesystem";
mongoose.connect(dbURL);
const db = mongoose.connection;
db.on('error', console.error.bind(console, 'connection error:'));
db.once('open', function() {

  // Handles Reading from GFS
  const gfs = Grid(db.db, mongoose.mongo);
  app.set('gfs', gfs);

  console.log("Connected to Database");
});

// Handles Writing to GFS - Can skip uploading tmp file as can be written straight to GFS
const storage = new GridFsStorage({
  url: dbURL,
  file: (req, file) => {
    const filename = file.originalname;
    const i = filename.lastIndexOf('.');
    return {
      // filename: `${filename.substring(0,i)}-${Date.now()}${filename.substr(i)}`,
      filename,
      metadata: {version: 0}

    }
  }
});

// Handles updating a GFS file - Need to query the DB to find the old meta data so needs intermediate tmp file
const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, `${__dirname}/tmpUploads`)
  },
  filename: function (req, file, cb) {
    cb(null, file.fieldname + '-' + Date.now())
  }
});

const upload = multer({storage});
const updater = multer({storage: diskStorage});


app.use(bodyParser.urlencoded({extended: true}));   // Parses application/x-www-form-urlencoded for req.body
app.use(bodyParser.json());                         // Parses application/json for req.body
app.use(morgan('dev'));

// expose environment variables to app
// app.set('jwtSecret', process.env.JWT_SECRET);


app.get('/files', FileController.getFiles);
app.get('/file/:_id', FileController.getFile);
app.post('/file', upload.single('file'), FileController.uploadFile);
app.post('/file/:_id', updater.single('file'), FileController.updateFile);
app.delete('/file/:_id', FileController.deleteFile);



// Initialize the Server
app.listen(3000, function() {
  console.log('Listening on port 3000');
});
