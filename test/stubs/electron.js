// Stub minimale di 'electron' per i test in Node
module.exports = {
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from('ENC:' + Buffer.from(s).toString('hex')),
    decryptString: (b) => Buffer.from(b.toString().slice(4), 'hex').toString(),
  },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
};
