// Import Modules
import express from 'express';
import mongoose from 'mongoose';
import bodyParser from 'body-parser';
import morgan from 'morgan';
import jwt from 'jsonwebtoken';
const app = express();

// Initialize .env
require('dotenv').config();

// Import Controllers
import * as FileController from './controllers/FileController';

// Initialize the DB
// mongoose.connect(process.env.DB);
// let db = mongoose.connection;
// db.on('error', console.error.bind(console, 'connection error:'));
// db.once('open', function() {
//   console.log("Connected to Database");
// });



// Register middleware (Must be done before CRUD handlers)
app.use(bodyParser.urlencoded({extended: true}));   // Parses application/x-www-form-urlencoded for req.body
app.use(bodyParser.json());                         // Parses application/json for req.body
app.use(morgan('dev'));

// expose environment variables to app
// app.set('jwtSecret', process.env.JWT_SECRET);



app.get('/file/:filename', FileController.getFile);
app.post('/file', FileController.createFile);
app.put('/file', FileController.updateFile);
app.delete('/file/:filename', FileController.deleteFile);





// Initialize the Server
app.listen(3000, function() {
  console.log('Listening on port 3000');
});