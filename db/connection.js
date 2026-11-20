import mongoose from 'mongoose';

let connected = false;

export async function connect() {
  if (connected) return;

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set in environment variables');

  mongoose.set('strictQuery', true);

  await mongoose.connect(uri, {
    dbName: process.env.DB_NAME ?? 'solace',
  });

  connected = true;
  console.log(`🍃 MongoDB connected → ${mongoose.connection.host}`);

  mongoose.connection.on('disconnected', () => {
    console.warn('⚠️  MongoDB disconnected');
    connected = false;
  });
  mongoose.connection.on('error', (err) => {
    console.error('MongoDB error:', err.message);
  });
}
