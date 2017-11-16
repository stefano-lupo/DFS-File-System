let files = new Map();
files.set("test.txt", "Wow you found test.txt");
files.set("password.txt", "Wow you found password.txt");
files.set("movies.txt", "Wow you found movies.txt");


export const getFile = (req, res) => {
  const { filename } = req.params;
    console.log(`${filename} requested`);
    const file = files.get(filename);
    if(file) {
      return res.send(file);
    } else {
      return res.send("No such file!");
    }
};

export const createFile = (req, res) => {
  const { filename, file } = req.body;
  console.log(`Creating file: ${filename}`);
  files.set(filename, file);
  res.send("File created!");

};

export const updateFile = (req, res) => {
  const { filename, file } = req.body;
  console.log(`Updating file: ${filename}`);
  files.set(filename, file);
  res.send("File Updated");
};

export const deleteFile = (req, res) => {
  const { filename }  = req.params;
  console.log(`Deleting : ${filename}`);
  files.delete(filename);
  res.send("Deleted file!");
};

