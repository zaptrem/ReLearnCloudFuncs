const functions = require("firebase-functions");
const speech = require("@google-cloud/speech");
const path = require("path");
const os = require("os");
const fs = require("fs");
const ffmpeg = require("fluent-ffmpeg");
const ffmpeg_static = require("ffmpeg-static");
const admin = require("firebase-admin");
admin.initializeApp();
const gcs = admin.storage();
const db = admin.firestore();
const express = require("express");
const cookieParser = require("cookie-parser")();
const cors = require("cors")({ origin: true });
const app = express();
const fetch = require("node-fetch");
const util = require('util')
const runtimeOpts = {
  timeoutSeconds: 540,
  memory: "1GB"
};

// // Create and Deploy Your First Cloud Functions
// // https://firebase.google.com/docs/functions/write-firebase-functions
//
// exports.helloWorld = functions.https.onRequest((request, response) => {
//  response.send("Hello from Firebase!");
// });
exports.analyzeRecording = functions
  .region("us-east1")
  .runWith(runtimeOpts)
  .firestore.document("users/{userId}/recordings/{recordingId}")
  .onWrite(async (change, context) => {
    // Match to group, add to group list. Does the group have a transcription?
    // did they reach the number for google transcription without an android phone?

    const document = change.after.exists ? change.after.data() : null;
    if(document == null) {
        print("document not found, likely deleted");
        return;
    }
    const recordingObject = document;
    let uri = recordingObject.uri;
    let storageAddress = recordingObject.storageAddress;
    let bucket = recordingObject.bucket;
    let convertedURI_pre = await convert(recordingObject);
    let convertedURI = "gs://" + bucket + "/" + convertedURI_pre;

    if (recordingObject.status != "NeedTranscription") return;

    let result = await transcribe(convertedURI, change.after);



    // Old server writes transcription code
    return change.after.ref.set(
      {
        transcription: result
      },
      { merge: true }
    );
  });
// Obv transcribes the audio..
async function transcribe(fileURI, snap) {
  // Creates a client
  const client = new speech.SpeechClient();

  // The name of the audio file to transcribe
  const fileName = fileURI;

  // Reads a local audio file and converts it to base64
  /*
  const file = fs.readFileSync(fileName);
  const audioBytes = file.toString('base64');
  */
  // The audio file's encoding, sample rate in hertz, and BCP-47 language code
  const audio = {
    uri: fileName
  };
  const config = {
    encoding: "flac",
    sampleRateHertz: 44100,
    languageCode: "en-US"
  };
  const request = {
    audio: audio,
    config: config
  };

  console.log("starting transcriptino");
  // Detects speech in the audio file
  try {
    const [operation] = await client.longRunningRecognize(request);
    snap.ref.set(
      {
        operation: operation.name,
        status: "CloudTranscribing"
      },
      { merge: true }
    );
    /*
    // Get a Promise representation of the final result of the job
    console.log("sent transcript request");
    const [response] = await operation.promise();
    console.log("got response");
    const transcription = response.results
      .map(result => result.alternatives[0].transcript)
      .join("\n");
    console.log(`Transcription: ${transcription}`);
    return transcription;
    */
  } catch (err) {
    console.log("something went wrong: " + err);
  }

  return;
}

// Makes an ffmpeg command return a promise.
function promisifyCommand(command) {
  return new Promise((resolve, reject) => {
    command
      .on("end", resolve)
      .on("error", reject)
      .run();
  });
}

async function convert(object) {
  const fileBucket = object["bucket"]; // The Storage bucket that contains the file.
  const filePath = object["storageAddress"]; // File path in the bucket.
  const contentType = object["contentType"]; // File content type.
  console.log(object);

  // Exit if this is triggered on a file that is not an audio.
  /*if (!contentType.startsWith('audio/')) {
    console.log('This is not an audio.');
    return null;
  }*/

  // Get the file name.
  const fileName = path.basename(filePath);
  // Exit if the audio is already converted.
  if (fileName.endsWith("_output.flac")) {
    console.log("Already a converted audio.");
    return null;
  }

  // Download file from bucket.
  const bucket = gcs.bucket(fileBucket);
  const tempFilePath = path.join(os.tmpdir(), fileName);
  // We add a '_output.flac' suffix to target audio file name. That's where we'll upload the converted audio.
  const targetTempFileName = fileName.replace(/\.[^/.]+$/, "") + "_output.flac";
  const targetTempFilePath = path.join(os.tmpdir(), targetTempFileName);
  const targetStorageFilePath = path.join(
    path.dirname(filePath),
    targetTempFileName
  );

  await bucket.file(filePath).download({ destination: tempFilePath });
  console.log("Audio downloaded locally to", tempFilePath);
  // Convert the audio to mono channel using FFMPEG.

  let command = ffmpeg(tempFilePath)
    .setFfmpegPath(ffmpeg_static.path)
    .audioChannels(1)
    .audioFrequency(44100)
    .format("flac")
    .output(targetTempFilePath);

  await promisifyCommand(command);
  console.log("Output audio created at", targetTempFilePath);
  //return targetTempFilePath;

  // Uploading the audio.
  const options = {
    destination: targetStorageFilePath,
    resumable: false
  };
  await bucket.upload(targetTempFilePath, options);
  console.log("Output audio uploaded to", targetStorageFilePath);

  // Once the audio has been uploaded delete the local file to free up disk space.
  fs.unlinkSync(tempFilePath);
  fs.unlinkSync(targetTempFilePath);
  console.log("Temporary files removed.", targetTempFilePath);
  return targetStorageFilePath;
}


// Take the text parameter passed to this HTTP endpoint and insert it into the
// Realtime Database under the path /messages/:pushId/original

// Express middleware that validates Firebase ID Tokens passed in the Authorization HTTP header.
// The Firebase ID token needs to be passed as a Bearer token in the Authorization HTTP header like this:
// `Authorization: Bearer <Firebase ID Token>`.
// when decoded successfully, the ID Token content will be added as `req.user`.
const validateFirebaseIdToken = async (req, res, next) => {
  console.log("Check if request is authorized with Firebase ID token");

  if (
    (!req.headers.authorization ||
      !req.headers.authorization.startsWith("Bearer ")) &&
    !(req.cookies && req.cookies.__session)
  ) {
    console.error(
      "No Firebase ID token was passed as a Bearer token in the Authorization header.",
      "Make sure you authorize your request by providing the following HTTP header:",
      "Authorization: Bearer <Firebase ID Token>",
      'or by passing a "__session" cookie.'
    );
    res.status(403).send("Unauthorized");
    return;
  }

  let idToken;
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer ")
  ) {
    console.log('Found "Authorization" header');
    // Read the ID Token from the Authorization header.
    idToken = req.headers.authorization.split("Bearer ")[1];
  } else if (req.cookies) {
    console.log('Found "__session" cookie');
    // Read the ID Token from cookie.
    idToken = req.cookies.__session;
  } else {
    // No cookie
    res.status(403).send("Unauthorized");
    return;
  }

  try {
    const decodedIdToken = await admin.auth().verifyIdToken(idToken);
    console.log("ID Token correctly decoded", decodedIdToken);
    req.user = decodedIdToken;
    next();
    return;
  } catch (error) {
    console.error("Error while verifying Firebase ID token:", error);
    res.status(403).send("Unauthorized");
    return;
  }
};

// HTTPS CHECK FUNCTION, PARAMS: operation, id, uid(the user id)
async function check(req, res) {
    console.log("Starting check");
  const operation = req.query.operation;
  //const id = req.query.id;
  //const uid = req.query.uid;
  // Push the new message into the Realtime Database using the Firebase Admin SDK.

  /*const snapshot = await admin
    .database()
    .ref("/messages")
    .push({ original: original });*/
  console.log(process.env.GOOGLE_APPLICATION_CREDENTIALS);
  //let token = admin.credential.cert(JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS)).getAccessToken;
  let tokenObj = await admin.credential.applicationDefault().getAccessToken();
  let token = tokenObj.access_token;
  console.log(token);

  const response = await fetch(
    `https://speech.googleapis.com/v1/operations/${operation}`,
    {
      method: "GET",
      headers: new fetch.Headers({
        Authorization: "Bearer " + token,
        Accept: "application/json"
      })
    }
  );

  /*let docRef = db
    .collection("users")
    .doc(uid)
    .collection("recordings")
    .doc(id);*/

  let returning = await response.json();

  console.log(returning);

  res.send(returning);
}
app.use(cors);
app.use(cookieParser);
app.use(validateFirebaseIdToken);
app.get("/", (req, res) => check(req, res));


// This HTTPS endpoint can only be accessed by your Firebase Users.
// Requests need to be authorized by providing an `Authorization` HTTP header
// with value `Bearer <Firebase ID Token>`.
exports.checkRecording = functions.region("us-east1").https.onRequest(app);
