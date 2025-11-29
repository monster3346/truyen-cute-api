// models/story.js
const mongoose = require('mongoose');

const chapterSchema = new mongoose.Schema({
  number: { 
    type: Number, 
    required: true, 
    min: 1,
    validate: {
      validator: Number.isInteger,
      message: 'Số chương phải là số nguyên'
    }
  },
  title: { type: String, required: true, trim: true },
  images: [{ 
    type: String, 
    trim: true,
    validate: {
      validator: function(v) {
        return v.startsWith('http') || v.startsWith('https');
      },
      message: 'URL ảnh không hợp lệ'
    }
  }], // Array
  content: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});

const storySchema = new mongoose.Schema({
  title: { 
    type: String, 
    required: true, 
    trim: true,
    maxlength: 200
  },
  author: { 
    type: String, 
    default: 'Đang cập nhật', 
    trim: true,
    maxlength: 100
  },
  cover: { 
    type: String, 
    default: '',
    validate: {
      validator: function(v) {
        return v === '' || v.startsWith('http') || v.startsWith('https');
      },
      message: 'URL cover phải bắt đầu bằng http/https'
    }
  },
  description: { 
    type: String, 
    default: '',
    maxlength: 2000
  },
  genres: [{
    type: String,
    trim: true,
    maxlength: 50
  }],
  slug: { 
    type: String, 
    unique: true, 
    required: true,
    lowercase: true
  },
  chapters: [chapterSchema],
  views: { 
    type: Number, 
    default: 0,
    min: 0
  }
}, { timestamps: true });

// Indexes
storySchema.index({ 'chapters.number': 1 });
storySchema.index({ genres: 1 });
storySchema.index({ updatedAt: -1 });

module.exports = mongoose.model('Story', storySchema);