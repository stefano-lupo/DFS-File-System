import path from 'path';

import express from 'express';
import mongoose from 'mongoose';
import Grid from 'gridfs-stream';
import multer from 'multer';
import GridFsStorage from 'multer-gridfs-storage';

import bodyParser from 'body-parser';
import morgan from 'morgan';
import jwt from 'jsonwebtoken';



// Import Controllers
import * as FileController from './controllers/FileController';



const app = express();


// Initialize .env
require('dotenv').config();

// Make Grid files accessible
const gridSchema = new mongoose.Schema({}, {strict: false});
const fileMeta = mongoose.model('fileMeta', gridSchema, 'fs.files');




// Initialize the DB
const dbURL = "mongodb://localhost/dfs_filesystem";
mongoose.connect(dbURL);
const db = mongoose.connection;
db.on('error', console.error.bind(console, 'connection error:'));
db.once('open', function() {
  app.set('fileMeta', fileMeta);
  console.log("Connected to Database");
});


const storage = new GridFsStorage({
  url: dbURL,
  file: (req, file) => {
    const filename = file.originalname;
    const i = filename.lastIndexOf('.');
    return {
      filename: `${filename.substring(0,i)}-${Date.now()}${filename.substr(i)}`
    }
  }
});
const upload = multer({storage});


app.use(bodyParser.urlencoded({extended: true}));   // Parses application/x-www-form-urlencoded for req.body
app.use(bodyParser.json());                         // Parses application/json for req.body
app.use(morgan('dev'));

// expose environment variables to app
// app.set('jwtSecret', process.env.JWT_SECRET);


app.get('/files', FileController.getFiles);
app.get('/file/:filename', FileController.getFile);
app.post('/file', upload.single('file'), FileController.uploadFile);
// app.put('/file', FileController.updateFile);
// app.delete('/file/:filename', FileController.deleteFile);



// Initialize the Server
app.listen(3000, function() {
  console.log('Listening on port 3000');
});
