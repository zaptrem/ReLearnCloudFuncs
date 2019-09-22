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
       uri = recordingObject.url;
       return change.after.ref.set({
        name_change_count: count + 1
      }, {merge: true});
});