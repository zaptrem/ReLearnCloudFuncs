const functions = require('firebase-functions');

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

       let result = "yeet";

       return change.after.ref.set({
        transcription: result
      }, {merge: true});
});