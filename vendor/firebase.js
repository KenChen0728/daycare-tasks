// Firebase 官方程式庫（固定版本）
export { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
export { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail, updatePassword, reauthenticateWithCredential, EmailAuthProvider } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
export { getFirestore, collection, doc, setDoc, updateDoc, deleteDoc, deleteField, getDocs, writeBatch, onSnapshot, query, where } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
