const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
import mongoose from 'mongoose';

const DIRECTORY_SERVER = "http://localhost:3001";
// const LOCK_SERVER = "http://localhost:3002";
const LOCK_SERVER = "http://192.168.1.17:3002";
const CACHING_SERVER = "http://localhost:3004";



/***********************************************************************************************************************
 * Client API
 **********************************************************************************************************************/


/**
 * POST /file
 * body: {file, filename, isPrivate}
 * Uploads a file to the Filesystem and notifies directory service of new file for this client
 * @response message indicating success/failure of upload
 */
//TODO: make this encrypted with session token like everything else
const uploadFile = async (req, res) => {
  const { clientId } = req;
  const { filename, isPrivate } = req.body;
  console.log(`Uploaded ${filename}`);

  const body = {
    file: {
      clientFileName: filename,
      isPrivate,
      remoteNodeAddress: req.app.get('ip'),
      remoteFileId: req.file.id
    },
    clientId
  };

  // Notify directory service of new file
  const { ok, status, response } = await makeRequest(`${DIRECTORY_SERVER}/notify`, "post", body);
  if(ok) {
    res.send({message: `Successfully saved ${filename} for ${clientId}`});
  } else {
    console.log(status, response);
    res.status(status).send({message: response});
  }

};


/**
 * POST /file/:_id
 * body: {file, lock}
 * Updates a file with the associated _id
 * @response message indicating success/failure of update
 */
//TODO: make this encrypted with session token like everything else
const updateFile = async(req, res) => {

  // Ensure client's lock is valid
  let { _id } = req.params;
  const { lock, filename } = req.body;
  const { clientId } = req;
  const {ok, status, response } = await makeRequest(`${LOCK_SERVER}/validate`, "post", {clientId, _id, lock});
  if(!ok || !response.valid) {
    console.log(response);
    return res.status(status).send(response);
  }


  // const newName = filename;
  _id = mongoose.Types.ObjectId(req.params._id);
  const gfs = req.app.get('gfs');

  console.log(`Updating File: ${_id}`);

  gfs.files.findOne({_id}, (err, fileMeta) => {
    if(!fileMeta) {
      console.log(`Could not find file ${_id}`);
      return res.status(404).send(`No such file ${_id} on this node.`)
    }

    const version = ++fileMeta.metadata.version;

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
      // TODO: Only notify directory service if something changes?
      writeStream.on('close', async (file) => {
        console.log(`File ${file.filename} was updated - closing`);

        // Delete the temp file
        fs.unlinkSync(req.file.path);

        // Check if file name was updated in this update
        if(fileMeta.filename !== filename) {

          // Let the directory service know to update its mapping
          const body = {_id, filename, clientId};
          const {ok, status, response} = await makeRequest(`${DIRECTORY_SERVER}/notify`, "put", body);
          if(!ok) {
            console.error(response);
            return res.status(status).send(response);
          }
        }

        // Let caching service know this file was updated
        const { ok, status, response } = await makeRequest(`${CACHING_SERVER}/notify/${_id}`, "put", {version});

        if(!ok) {
          console.error(response);
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
const deleteFile = async (req, res) => {
  const gfs = req.app.get('gfs');
  const _id = mongoose.Types.ObjectId(req.params._id);
  const { clientId } = req;

  gfs.remove({_id}, async (err) => {
    if (err) return res.status(500).send(err);

    // Notify directory service that file was deleted
    const {ok, status, response} = await makeRequest(`${DIRECTORY_SERVER}/remoteFile/${clientId}/${_id}`, "delete");
    if(!ok) {
      console.log(response);
      return res.status(status).send(response);
    }

    console.log(`Deleted file ${_id}`);
    res.send({message: `Deleted file ${_id}`});
  });
};



/**
 * NOTE DEBUG/ADMIN ONLY (or at least it should be)
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


