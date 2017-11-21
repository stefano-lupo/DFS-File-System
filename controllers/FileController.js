const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
import mongoose from 'mongoose';

const DIRECTORY_SERVER = "http://localhost:3001";

/**
 * GET files
 * Gets all Files on this nodes filesystem (admin)
 */
const getFiles = (req, res) => {
  const gfs = req.app.get('gfs');
  gfs.files.find({}).toArray((err, files) => {
    if(err) {
      return res.send(err);
    }

    res.send(files);
  })
};


/**
 * POST /file
 * Uploads a file to the Filesystem and notifies directory service of new file for this client
 */
const uploadFile = async (req, res) => {
  const filename = req.file.originalname;
  console.log("Uploadeded " + filename);
  const body = {
    file: {
      clientFileName: filename,
      private: req.body.private,
      remoteNodeAddress: "localhost:3000",
      remoteFileId: req.file.id
    },
    email: req.body.email
  };

  const { ok, status, response } = await notifyDirectoryServer("post", body);
  if(ok) {
    res.send(`Successfully saved ${filename} for ${req.body.email}`);
  } else {
    console.log(status, response);
    res.status(500).send(`Error saving ${filename} for ${req.body.email}`);
  }

};


/**
 * POST /file/:_id
 * Updates a file with the associated _id
 */
const updateFile = async(req, res) => {
  const newName = req.file.originalname;
  let _id = mongoose.Types.ObjectId(req.params._id);
  const gfs = req.app.get('gfs');

  console.log(`Updating File: ${_id}`);

  gfs.files.findOne({_id}, (err, fileMeta) => {
    if(!fileMeta) {
      console.log(`Could not find file ${_id}`);
      return res.status(404).send(`No such file ${_id} on this node.`)
    }

    const version = ++fileMeta.metadata.version;
    let { filename } = fileMeta;

    // Update filename if changed
    filename = (filename === newName) ? filename : newName;

    // Delete old file
    gfs.remove({_id}, (err) => {
      if (err) {
        console.log(`Error: ${err}`);
        return res.send(err);
      }
      console.log(`Removed file ${_id}`);
      console.log(`Writing new file ${filename}, version = ${version} from ${req.file.path}`);

      // Save the uploaded file in its place
      const writeStream = gfs.createWriteStream({_id, filename, metadata: {version}});
      fs.createReadStream(req.file.path).pipe(writeStream);

      writeStream.on('close', async (file) => {
        console.log(`File ${file.filename} was updated - closing`);
        // return res.send(`File ${file.filename} was updated - closing`)
        const body = {_id, filename, email: req.body.email};
        const {ok, status, response} = await notifyDirectoryServer("put", body);
        if(!ok) {
          console.log(response);
          return res.status(status).send(`Unable to update ${filename}`);
        }

        res.send(`File ${filename} updated successfully`);
      })
    });




  });
};


/**
 * GET /file/:_id
 * Gets file with associated _id
 */
const getFile = async (req, res) => {
  const gfs = req.app.get('gfs');
  const { _id } =  req.params;

    gfs.findOne({_id}, (err, file) => {
      if (err) {
        return res.status(400).send(err);
      }
      else if (!file) {
        return res.status(404).send(`File ${_id} is not contained on this node`);
      }
      res.set('Content-Type', file.contentType);
      res.set('Content-Disposition', 'attachment; filename="' + file.filename + '"');

      const readstream = gfs.createReadStream({_id: file._id});

      readstream.on("error", function(err) {
        console.log(err);
        res.end();
      });
      readstream.pipe(res);
    })
};

/**
 * DELETE file/:_id
 * Deletes file with specified id
 */
const deleteFile = (req, res) => {
  const gfs = req.app.get('gfs');
  const _id = mongoose.Types.ObjectId(req.params._id);

  gfs.remove({_id}, function (err) {
    if (err) return res.send("error");
    console.log(`Deleted file ${_id}`);
    res.send(`Deleted file ${_id}`);
  });
};

async function notifyDirectoryServer(method, body) {
  console.log("fetching");
  let response = await fetch(`${DIRECTORY_SERVER}/notify`, {method, body: JSON.stringify(body), headers: {'Content-Type': 'application/json'}});
  console.log("finished");

  const { ok, status } = response;

  const contentType = response.headers.get("content-type");
  if(contentType && contentType.indexOf("application/json") !== -1) {
    response = await response.json();
  } else {
    response = await response.text();
  }

  console.log("OK : ", ok);
  console.log("OK : ", status);
  console.log("OK : ", response);
  return {
    ok,
    status,
    response
  }

}

module.exports = {
  getFile,
  getFiles,
  uploadFile,
  updateFile,
  deleteFile,
};


