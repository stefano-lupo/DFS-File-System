import express from 'express';
import mongoose from 'mongoose';
import Grid from 'gridfs-stream';
import multer from 'multer';
import GridFsStorage from 'multer-gridfs-storage';
import uuidv1 from 'uuid';

import bodyParser from 'body-parser';
import morgan from 'morgan';
import jwt from 'jsonwebtoken';

// Import Controllers
import * as FileController from './controllers/FileController';

const app = express();

// Initialize .env
require('dotenv').config();


// Initialize the DB
const dbURL = "mongodb://localhost/dfs_filesystem";
mongoose.connect(dbURL);
const db = mongoose.connection;
db.on('error', console.error.bind(console, 'connection error:'));
db.once('open', function() {

  // Handles Reading from GFS
  const gfs = Grid(db, mongoose.mongo);
  app.set('gfs', gfs);

  console.log("Connected to Database");
});

// Handles Writing to GFS
const storage = new GridFsStorage({
  url: dbURL,
  file: (req, file) => {
    const filename = file.originalname;
    const i = filename.lastIndexOf('.');
    return {
      filename: `${filename.substring(0,i)}-${Date.now()}${filename.substr(i)}`,
      metadata: {version: 0, uuid: uuidv1()}
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
app.get('/file/:uuid', FileController.getFile);
app.post('/file', upload.single('file'), FileController.uploadFile);
app.post('/file/:uuid', upload.single('file'), FileController.updateFile);
app.delete('/file/:uuid', FileController.deleteFile);
// app.put('/file', FileController.updateFile);
// app.delete('/file/:filename', FileController.deleteFile);



// Initialize the Server
app.listen(3000, function() {
  console.log('Listening on port 3000');
});
