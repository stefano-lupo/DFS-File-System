# Distributed File System: File System Nodes
This repo contains the code for the file system nodes for my distributed file system. Links to all components of my file system can be found in the repo for the [test client and client library](https://github.com/stefano-lupo/DFS-Client)

## The File System Nodes
The file system nodes make use of [MongoDB's GridFS](https://docs.mongodb.com/v3.4/core/gridfs/) which is ideal for storing large chunks of data such as files, images and even video / audio. The database contains two collections - one for file meta data and one with file chunks. The file meta data collection can be easily queried to find certain files etc and the chunks collection is used to store the actual file data.   

Files are uploaded using multipart/form-data which is handled using [multer](https://github.com/expressjs/multer) and [gridfs-stream](https://github.com/aheckmann/gridfs-stream).

## Encryption / Authentication
All client requests are behind a piece of middleware which examines the supplied token, attempts to decrypt it using the server key (known to all server nodes) and verify its contents. This middleware also sets the `clientId` (contained in the encrypted token) field of an incoming request (if it could be authenticated), allowing the controllers to know which client they are servicing. Finally, it also sets `req.decrypted` with the decrypted contents of the body of any POST requests.

## Replication
In order to allow data to be replicated across multiple file system nodes, a master / slave system was used. All writes were directed at the master and all reads to one of the slave nodes. Each of the slave nodes had their own GridFS to store things in and each file was replicated on every node (although this is configurable in the directory service). Upon receiving a write, the master proceeds to notify the directory service of the creation/update/deletion, who in turn responds with the list of slave nodes who should store / are currently storing that file. This allows a flexible number of nodes to store each file which could be useful as a load balancing feature (eg if some files are being accessed more frequently than others, more slave noes could store that file). The master can the push all of the updates to the slave nodes.


## Client API
- Any POST requests (other than file uploads) should contain a single `encrypted` field which contains an encrypted version of the results of `JSON.stringify(actualBody)`. 
  - This will be decrypted and parsed by the file system nodes to extract the actual body of the request.
- `MASTER` refers to the endpoint returned from making a request to the directory service asking for a write endpoint.
- `SLAVE` refers to the endpoint returned from making a request to the directory service asking for a read endpoint.

    
The file system nodes expose the following endpoints:
    

#### `POST <MASTER>/file`
- **body**
  - `filename`: the full filepath of the file to be stored (eg `/home/stefano/Documents/myfile.txt`)
  - `isPrivate`: whether or not this file is accessible by others
  - `file`: the file itself encoded using multipart/form-data
- Saves the file in `MASTER`'s GFS along with:
    - `version`: 0
    - `filename`: name of the file as specified in the body of the POST
    - `uploadDate`: the date the file was uploaded
- Informs Directory Service of the new file for `req.clientId` (extracted from the Auth token)
- Pushes this new file to all of the `SLAVE` nodes that the Directory Service responds with.

#### `POST <MASTER>/file/:_id`
- **body**
  - `lock`: the lock given to the client for this file from the locking service.
  - `file`: the file itself encoded using multipart/form-data
- Ensures lock is valid by making a request to the Locking Service for validation.
- Updates the file contained in the `MASTER`'s GFS with the specified `_id` with the contents of the uploaded `file` and increments the `version`.
- Informs the Directory Service of the update (in case the file name changes - the directory service would then also need to update).
- Pushes the changes to all of the `SLAVE` nodes who are storing this file (a list of whom are provided in the response from the Directory Service).
- Informs the Caching Service of the update so it can invalidate the caches of all clients subscribed to this file.


#### `GET <SLAVE>/file/:_id`
- Sends the contents of the file with the specified `_id`.
- Uses `Content-Disposition: attachment; filename=<filename>`

#### `DELETE <MASTER>/file/:_id`
- Deletes the file of specified `_id` from `MASTER`
- Notifies the Directory Service of the deletion.
- Notifies all of the `SLAVE`'s who are storing this file (as given in the response from the Directory Service) to drop the file.


## Slave API
The file system slave nodes also expose an endpoint so that the master node can push files to slaves.

#### POST <SLAVE>/slave/:_id
- **body**
  - `filename`: the name of the file to store
  - `file`: the file itself to store
- As the slaves must always be saving the file with a predetermined `_id` (as determined by the master upon creation), this same endpoint is used for both the initial creation of a file on a slave node and the updating of a file already contained on a slave node.


















