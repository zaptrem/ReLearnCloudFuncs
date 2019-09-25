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
const runtimeOpts = {
  timeoutSeconds: 540,
  memory: "512MB"
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
  .onCreate(async (snap, context) => {
    // Match to group, add to group list. Does the group have a transcription?
    // did they reach the number for google transcription without an android phone?

    const recordingObject = snap.data();
    let uri = recordingObject.uri;
    let storageAddress = recordingObject.storageAddress;
    let bucket = recordingObject.bucket;
    let convertedURI_pre = await convert(recordingObject);
    let convertedURI = "gs://" + bucket + "/" + convertedURI_pre;

    let result = await transcribe(convertedURI);

    return snap.ref.set(
      {
        transcription: result
      },
      { merge: true }
    );
  });
// Obv transcribes the audio..
async function transcribe(fileURI) {
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
    // Get a Promise representation of the final result of the job
    console.log("sent transcript request");
    const [response] = await operation.promise();
    console.log("got response");
    const transcription = response.results
      .map(result => result.alternatives[0].transcript)
      .join("\n");
    console.log(`Transcription: ${transcription}`);
    return transcription;
  } catch (err) {
    console.log("something went wrong: " + err);
  }
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
