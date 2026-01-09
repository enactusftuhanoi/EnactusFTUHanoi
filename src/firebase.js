const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const path = require('path');
require('dotenv').config();

// Khởi tạo Firebase Admin SDK
let db;

function initializeFirebase() {
  try {
    // Sử dụng service account key
    const serviceAccount = require(path.join(__dirname, '../firebase/serviceAccountKey.json'));
    
    initializeApp({
      credential: applicationDefault() || require('firebase-admin').credential.cert(serviceAccount),
      databaseURL: `https://${process.env.FIREBASE_PROJECT_ID}.firebaseio.com`
    });
    
    db = getFirestore();
    console.log('✅ Firebase initialized successfully');
    return db;
  } catch (error) {
    console.error('❌ Firebase initialization error:', error);
    throw error;
  }
}

// Helper functions để tương tác với Firestore
const firebaseService = {
  // Tìm thành viên bằng email
  async findMemberByEmail(email) {
    try {
      const membersRef = db.collection('members');
      const snapshot = await membersRef
        .where('email', '==', email.toLowerCase())
        .limit(1)
        .get();
      
      if (snapshot.empty) {
        return null;
      }
      
      const doc = snapshot.docs[0];
      return {
        id: doc.id,
        ...doc.data()
      };
    } catch (error) {
      console.error('Error finding member by email:', error);
      throw error;
    }
  },

  // Cập nhật thông tin Discord của thành viên
  async updateDiscordInfo(memberId, discordData) {
    try {
      const memberRef = db.collection('members').doc(memberId);
      await memberRef.update({
        discord_id: discordData.id,
        discord_username: discordData.username,
        discord_display_name: discordData.displayName,
        verified_at: new Date().toISOString(),
        verified: true,
        last_verified: new Date().toISOString()
      });
      return true;
    } catch (error) {
      console.error('Error updating Discord info:', error);
      throw error;
    }
  },

  // Kiểm tra xem Discord ID đã được verify chưa
  async isDiscordIdVerified(discordId) {
    try {
      const membersRef = db.collection('members');
      const snapshot = await membersRef
        .where('discord_id', '==', discordId)
        .where('verified', '==', true)
        .limit(1)
        .get();
      
      return !snapshot.empty;
    } catch (error) {
      console.error('Error checking Discord ID:', error);
      throw error;
    }
  },

  // Lấy thông tin thành viên bằng Discord ID
  async getMemberByDiscordId(discordId) {
    try {
      const membersRef = db.collection('members');
      const snapshot = await membersRef
        .where('discord_id', '==', discordId)
        .limit(1)
        .get();
      
      if (snapshot.empty) {
        return null;
      }
      
      const doc = snapshot.docs[0];
      return {
        id: doc.id,
        ...doc.data()
      };
    } catch (error) {
      console.error('Error getting member by Discord ID:', error);
      throw error;
    }
  },

  // Lấy tất cả thành viên chưa verify (cho admin)
  async getUnverifiedMembers() {
    try {
      const membersRef = db.collection('members');
      const snapshot = await membersRef
        .where('verified', '==', false)
        .get();
      
      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
    } catch (error) {
      console.error('Error getting unverified members:', error);
      throw error;
    }
  }
};

module.exports = {
  initializeFirebase,
  db: () => db,
  firebaseService
};