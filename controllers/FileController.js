const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
import mongoose from 'mongoose';

const DIRECTORY_SERVER = "http://localhost:3001";
const LOCK_SERVER = "http://192.168.1.17:3002";



/***********************************************************************************************************************
 * API
 **********************************************************************************************************************/


/**
 * GET /files
 * Gets all Files on this nodes filesystem (admin)
 * @response JSON array containing all the files on this node
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
 * body: {file, private, email}
 * Uploads a file to the Filesystem and notifies directory service of new file for this client
 * @response message indicating success/failure of upload
 */
const uploadFile = async (req, res) => {
  const filename = req.file.originalname;
  console.log(`Uploaded ${filename}`);
  const body = {
    file: {
      clientFileName: filename,
      private: req.body.private,
      remoteNodeAddress: "http://localhost:3000",
      remoteFileId: req.file.id
    },
    email: req.body.email
  };

  // Notify directory service of new file
  const { ok, status, response } = await makeRequest(`${DIRECTORY_SERVER}/notify`, "post", body);
  if(ok) {
    res.send({message: `Successfully saved ${filename} for ${req.body.email}`});
  } else {
    console.log(status, response);
    res.status(status).send({message: response});
  }

};


/**
 * POST /file/:_id
 * body: {email, file, lock}
 * Updates a file with the associated _id
 * @response message indicating success/failure of update
 */
const updateFile = async(req, res) => {

  // Ensure client's lock is valid
  let { _id } = req.params;
  const { email, lock } = req.body;
  const {ok, status, response } = await makeRequest(`${LOCK_SERVER}/validate`, "post", {email, _id, lock});
  if(!ok || !response.valid) {
    return res.status(status).send(response);
  }


  const newName = req.file.originalname;
  _id = mongoose.Types.ObjectId(req.params._id);
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
        return res.status(500).send(err);
      }
      console.log(`Removed file ${_id}`);
      console.log(`Writing new file ${filename}, version = ${version} from ${req.file.path}`);

      // Save the uploaded file in its place
      const writeStream = gfs.createWriteStream({_id, filename, metadata: {version}});
      fs.createReadStream(req.file.path).pipe(writeStream);

      // Notify directory service of updated file
      writeStream.on('close', async (file) => {
        console.log(`File ${file.filename} was updated - closing`);

        const body = {_id, filename, email: req.body.email};
        const {ok, status, response} = await makeRequest(`${DIRECTORY_SERVER}/notify`, "put", body);
        if(!ok) {
          console.log(response);
          return res.status(status).send(response);
        }

        res.send({message: `File ${filename} updated successfully`});
      })
    });
  });
};


/**
 * GET /file/:_id
 * Gets file with associated _id
 * @response the full file
 */
const getFile = async (req, res) => {
  const gfs = req.app.get('gfs');
  const { _id } =  req.params;

    gfs.findOne({_id}, (err, file) => {
      if (err) {
        return res.status(500).send(err);
      }
      else if (!file) {
        return res.status(404).send({message: `File ${_id} is not contained on this node`});
      }

      // Send the file to the client
      res.set('Content-Type', file.contentType);
      res.set('Content-Disposition', 'attachment; filename="' + file.filename + '"');

      const readstream = gfs.createReadStream({_id: file._id});

      readstream.on("error", (err) => {
        console.log(err);
        res.status(500).send({message: `An error occurred reading file ${_id} from GFS`});
      });

      readstream.pipe(res);
    })
};

/**
 * DELETE file/:_id
 * Deletes file with specified id
 * @response message indicating the deletion was a success / failure
 */
const deleteFile = (req, res) => {
  const gfs = req.app.get('gfs');
  const _id = mongoose.Types.ObjectId(req.params._id);

  gfs.remove({_id}, (err) => {
    if (err) return res.status(500).send(err);

    console.log(`Deleted file ${_id}`);
    res.send({message: `Deleted file ${_id}`});
  });
};



/***********************************************************************************************************************
 * Helper Methods
 **********************************************************************************************************************/
async function makeRequest(endpoint, method, body) {
  const headers =  {'Content-Type': 'application/json'};
  let response;
  if(body) {
    response = await fetch(endpoint, {method, body: JSON.stringify(body), headers});
  } else {
    response = await fetch(endpoint, {method, headers})
  }

  const { ok, status } = response;

  const contentType = response.headers.get("content-type");
  if(contentType && contentType.indexOf("application/json") !== -1) {
    response = await response.json();
  }

  return {ok, status, response}

}

module.exports = {
  getFile,
  getFiles,
  uploadFile,
  updateFile,
  deleteFile,
};


