const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
import mongoose from 'mongoose';
import FormData from 'form-data';

const DIRECTORY_SERVER = "http://localhost:3001";
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
export const uploadFile = async (req, res) => {
  const { clientId } = req;
  const { filename, isPrivate } = req.body;
  console.log(`Uploaded ${filename}`);


  // Notify directory service of new file
  const body = {
    file: {
      clientFileName: filename,
      isPrivate,
      remoteNodeAddress: req.app.get('ip'),
      remoteFileId: req.file.id
    },
    clientId
  };

  const { ok, status, response } = await makeRequest(`${DIRECTORY_SERVER}/notify`, "post", body);
  if(ok) {
    const { slaves } = response;
    await pushFileToSlaves(slaves, req.file.id, filename, req.app.get('gfs'), req.app.get('dir'));
    res.send({message: `Successfully saved ${filename} for ${clientId}`});
  } else {
    console.log(status, response);
    res.status(status).send({message: response});
  }

};


/**
 * POST /file/:_id
 * body: {file, lock}
 * Updates a file with the associated _id and pushes changes to slaves
 * Also informs directory service and caching service of the update
 * @response message indicating success/failure of update
 */
//TODO: make this encrypted with session token like everything else
export const updateFile = async(req, res) => {

  // Ensure client's lock is valid
  let { _id } = req.params;
  const { lock, filename } = req.body;
  const { clientId } = req;
  const {ok, status, response } = await makeRequest(`${LOCK_SERVER}/validate`, "post", {clientId, _id, lock});
  if(!ok || !response.valid) {
    console.log(response);
    return res.status(status).send(response);
  }

  // Get the file from GFS
  console.log(`Updating File: ${_id}`);
  _id = mongoose.Types.ObjectId(req.params._id);
  const gfs = req.app.get('gfs');


  gfs.files.findOne({_id}, (err, fileMeta) => {

    // If no file entry, file not on this node
    if(!fileMeta) {
      console.log(`Could not find file ${_id}`);
      return res.status(404).send(`No such file ${_id} on this node.`)
    }

    // Otherwise, increment the files version
    const version = ++fileMeta.metadata.version;

    // Delete old file
    gfs.remove({_id}, (err) => {

      if (err) {
        console.log(`Error: ${err}`);
        return res.status(500).send(err);
      }

      console.log(`Removed old version of ${_id}`);
      console.log(`Writing new file ${filename}, version = ${version} from ${req.file.path}`);

      // Save the updated file that was just uploaded in its place
      const writeStream = gfs.createWriteStream({_id, filename, metadata: {version}});
      fs.createReadStream(req.file.path).pipe(writeStream);


      // Once the file has been successfully updated in the database
      writeStream.on('close', async (file) => {
        console.log(`File ${file.filename} was updated`);

        // Delete the temp file that was uploaded
        fs.unlinkSync(req.file.path);


        // Let the directory service know to update its mapping
        const body = {_id, filename, clientId};
        let {ok, status, response} = await makeRequest(`${DIRECTORY_SERVER}/notify`, "put", body);
        if(!ok) {
          console.error(response);
          return res.status(status).send(response);
        }


        // Push changes to slaves
        await pushFileToSlaves(response.slaves, _id.toString(), filename, gfs, req.app.get('dir'));
        if(!ok) {
          console.error(response);
          return res.status(status).send(response);
        }


        // Let caching service know this file was updated so it can invalidate clients caches
        ({ ok, status, response } = await makeRequest(`${CACHING_SERVER}/notify/${_id}`, "put", {version}));
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
export const getFile = async (req, res) => {
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
export const deleteFile = async (req, res) => {
  const gfs = req.app.get('gfs');
  const _id = mongoose.Types.ObjectId(req.params._id);
  const { clientId } = req;

  gfs.remove({_id}, async (err) => {
    if (err) return res.status(500).send(err);

    // If I am not the master, my work is done.
    if(req.app.get('role') === 'slave') {
      return res.send({message: `Successfully dropped file`});
    }

    // Notify directory service that file was deleted
    const {ok, status, response} = await makeRequest(`${DIRECTORY_SERVER}/remoteFile/${clientId}/${_id}`, "delete");
    if(!ok) {
      console.error(response);
      return res.status(status).send(response);
    }

    // Tell all slaves to drop the file
    const requests = response.slaves.map(slave => {
      return makeRequest(`${slave}`)
    });

    await Promise.all(requests);

    console.log(`Deleted file ${_id}`);
    res.send({message: `Deleted file ${_id}`});
  });
};


/***********************************************************************************************************************
 * Slave API
 **********************************************************************************************************************/


/**
 * POST /slave/:_id
 * Notifies Slave to store / update a file
 *
 */
export const receiveUpdateFromMaster = async (req, res) => {
  // Ensure client's lock is valid
  let { _id } = req.params;
  const { filename } = req.body;

  _id = mongoose.Types.ObjectId(_id);
  const gfs = req.app.get('gfs');

  console.log(`Updating File: ${_id}`);

  gfs.files.findOne({_id}, async (err, fileMeta) => {

    // Delete old file
    if(fileMeta) {
      const version = ++fileMeta.metadata.version;

      // Not sure if this will work
      await gfs.remove({_id}, (err));
        console.log(`Removed file ${_id}`);
        console.log(`Writing new file ${filename}, version = ${version} from ${req.file.path}`);

        // Save the uploaded file in its place
        const writeStream = gfs.createWriteStream({_id, filename, metadata: {version}});
        fs.createReadStream(req.file.path).pipe(writeStream);

        writeStream.on('close', async (file) => {
          console.log(`File ${file.filename} was updated - closing`);

          // Delete the temp file
          fs.unlinkSync(req.file.path);

          res.send({message: `File ${filename} updated successfully`});
        })
      // });
    } else {
      const version = 0;
      console.log(`Writing new file ${filename}, version = ${version} from ${req.file.path}`);

      // Save the uploaded file in its place
      const writeStream = gfs.createWriteStream({_id, filename, metadata: {version}});
      fs.createReadStream(req.file.path).pipe(writeStream);

      writeStream.on('close', async (file) => {
        console.log(`File ${file.filename} was updated - closing`);

        // Delete the temp file
        fs.unlinkSync(req.file.path);

        res.send({message: `File ${filename} updated successfully`});
      })
    }
  });
};


/**
 * NOTE DEBUG ONLY (or at least it should be)
 * GET /files
 * Gets all Files on this nodes filesystem (admin)
 * @response JSON array containing all the files on this node
 */
export const getFiles = (req, res) => {
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


/**
 * Pushes a file to all of the slave nodes
 * @param slaves the list of nodes to push to
 * @param remoteFileId the id of the file updated
 * @param filename the (potentially) updated file name
 * @param gfs Grid File System instance
 * @param tmpdir Master's temporary files directory to write to
 * @returns {Promise} that resolves once all slaves have received the file
 */
async function pushFileToSlaves(slaves, remoteFileId, filename, gfs, tmpdir) {
  // Couldn't get streams to cooperate here, so just write it to a temp file and read form there (ew)
  const writeStream = fs.createWriteStream(`${tmpdir}/${remoteFileId}.txt`);
  const fromGfs = gfs.createReadStream({_id: remoteFileId});
  fromGfs.pipe(writeStream);

  // Each worker must have fully received the file before we can progress
  // Otherwise the cache service will be notified, and clients will attempt to pull down changes
  // from slave nodes who may not yet have the updated file available
  return new Promise((resolve, reject) => {
    fromGfs.on('error', (err) => {
      console.error(`err: `, err);
      reject();
    });

    fromGfs.on('close', async () => {

      // Push changes to all slaves
      const pushedChangesToSlave = slaves.map((slave) => {
        console.log(`Pushing changes to slave ${slave}`);

        // Read from the temporary file that was just created
        const readStream = fs.createReadStream(`${tmpdir}/${remoteFileId}.txt`);

        // Build the form data
        const formData = new FormData();
        formData.append('filename', filename);
        formData.append('file', readStream);
        return fetch(`${slave}/slave/${remoteFileId}`, {method: 'POST', body: formData});
      });

      // Move on once all slaves have received the file
      await Promise.all(pushedChangesToSlave);
      console.log(`Finished pushing changes to slaves, resolving`);
      resolve();
    });
  });
}


