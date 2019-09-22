

const functions = require('firebase-functions');
const speech = require('@google-cloud/speech')

// // Create and Deploy Your First Cloud Functions
// // https://firebase.google.com/docs/functions/write-firebase-functions
//
// exports.helloWorld = functions.https.onRequest((request, response) => {
//  response.send("Hello from Firebase!");
// });
exports.analyzeRecording = functions.firestore
  .document('users/{userId}/recordings/{recordingId}')
  .onCreate((snap, context) => {
       // Match to group, add to group list. Does the group have a transcription?
       // did they reach the number for google transcription without an android phone?

       const recordingObject = snap.data();
       let uri = recordingObject.uri;
       let storageAddress = recordingObject.storageAddress;
       let bucket = recordingObject.bucket;

       let result = await recognizeSpeech(uri, storageAddress, bucket);


       return change.after.ref.set({
        transcription: result
      }, {merge: true});
});

async function recognizeSpeech(metadata: RecordingMetadata): {
    const languageCode = metadata.language;
    const sampleRateHertz = metadata.sampleRate;
    const encoding = metadata.encoding;

    const recognizeRequest = {
        config: {
            enableWordTimeOffsets: true,
            languageCode: "en-US",
            sampleRateHertz : "16000",
            encoding,
        },
        audio: {
            uri : `gs://${bucket}${path}`
        }
    };

    console.info('recognizeRequest:', recognizeRequest);
    const recognizeResponse = await speechClient.recognize(recognizeRequest);
    console.log('recognizeResponse:', recognizeResponse);
    if (recognizeResponse.length === 0
        || recognizeResponse[0].results.length === 0
        || recognizeResponse[0].results[0].alternatives.length === 0) {
            throw new Error("No speech recognized")
    };
    return recognizeResponse[0].results[0].alternatives[0].transcript;
}
