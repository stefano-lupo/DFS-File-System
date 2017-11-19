const fs = require('fs');
const path = require('path');

const getFiles = (req, res) => {
  const fileMeta = req.app.get('fileMeta');
  fileMeta.find({}, (err, files) => {
    if(err) {
      return res.send(err);
    }

    res.send(files);
  })
};

const uploadFile = (req, res) => {
  res.send("hi");
};

const getFile = async (req, res) => {
  const gfs = req.app.get('gfs');

  gfs.findOne({_id: "5a11c3b1e41453654de30e5a"}, (err, file) => {
    if (err) {
      return res.status(400).send(err);
    }
    else if (!file) {
      return res.status(404).send('Error on the database looking for the file.');
    }
    res.set('Content-Type', file.contentType);
    res.set('Content-Disposition', 'attachment; filename="' + file.filename + '"');

    const readstream = gfs.createReadStream({
      _id: "5a11c3b1e41453654de30e5a",
    });

    readstream.on("error", function(err) {
      console.log(err);
      res.end();
    });
    readstream.pipe(res);
  })
};

module.exports = {
  getFile,
  getFiles,
  uploadFile
};


