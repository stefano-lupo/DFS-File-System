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
      remoteFileId: req.file.metadata.uuid
    },
    email: req.body.email
  };


  let response = await fetch(`${DIRECTORY_SERVER}/notify`, {method: "post", body: JSON.stringify(body), headers: {'Content-Type': 'application/json'}})
  if(response.ok) {
    res.send(`Successfully saved ${filename} for ${req.body.email}`);
  } else {
    res.status(500).send(`Error saving ${filename} for ${req.body.email}`);
  }

};


/**
 * POST /file/:uuid
 * Updates a file with the associated metadata.uuid
 */
const updateFile = async(req, res) => {
  let { uuid } = req.params;
  const gfs = req.app.get('gfs');
  gfs.files.findOne({'metadata.uuid': uuid}, (err, fileMeta) => {
    if(!fileMeta) {
      console.log(`Could not find file ${uuid}`);
      return res.status(404).send(`No file ${uuid}`)
    }
    console.log("Found file by uuid for deletion");

    // console.log(fileMeta);
    const _id = mongoose.Types.ObjectId(fileMeta._id);
    const version = ++fileMeta.metadata.version;


    // delete old file
    gfs.remove({_id}, function (err, test) {
      if (err) return console.log(err);
      console.log('success');

      console.log(test);
      console.log("Deleted file version ", version-1);

      // update new file to be same as old file
      gfs.files.update(
        { _id: req.file.id },
        { $set: {
          _id,
          'metadata.version': version,
          'metadata.uuid': uuid
        } }
        , null,
        (err, file) => {
          if(err) return res.status(500).send("Error");
          if(!file) return res.status(404).send("Error");
          res.send("Successfully updated file");
        });

    });


    // res.send("?")
  });
};


/**
 * GET /file/:uuid
 * Gets file with associated metadata.uuid
 */
const getFile = async (req, res) => {
  const gfs = req.app.get('gfs');
  const { uuid } =  req.params;

  gfs.files.findOne({'metadata.uuid': uuid}, (err, fileMeta) => {
    gfs.findOne({_id: fileMeta._id}, (err, file) => {
      if (err) {
        return res.status(400).send(err);
      }
      else if (!file) {
        return res.status(404).send(`File ${uuid} is not contained on this node`);
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
  })
};

/**
 * DELETE file/:uuid
 * Deletes file with specified uuid
 */
const deleteFile = (req, res) => {
  const gfs = req.app.get('gfs');
  const { uuid } = req.params;
  const _id = mongoose.Types.ObjectId("5a14166c041ed908d4f06762");

  gfs.remove({_id}, function (err) {
    if (err) return res.send("error");
    console.log("Removed file chunks");
  });
  console.log("about to start remove file");
  gfs.files.remove({_id}, (err2) => {
    if(err2) return res.send("error");
    console.log("Removed file itself");
  });
  res.send("who knows")
};

module.exports = {
  getFile,
  getFiles,
  uploadFile,
  updateFile,
  deleteFile,
};


