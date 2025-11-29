// server.js
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const slugify = require('slugify');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const sanitizeHtml = require('sanitize-html');

const app = express();

// ==================== MIDDLEWARES ====================
app.use(express.json({ limit: '20mb' }));
app.use(helmet({
  contentSecurityPolicy: false, // tắt tạm để admin.html inline script chạy ngon
}));

// CORS – cho phép mọi nguồn khi dev, production thì giới hạn lại
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
  'http://localhost:3000',
  'http://localhost:10000',
  'http://127.0.0.1:5500',  // Live Server VS Code
  'https://truyen-cute-api.onrender.com'
];

app.use(cors({
  origin: (origin, callback) => {
    // Cho phép request không có origin (Postman, curl) hoặc origin được phép
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true
}));

// Rate limit
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 phút
  max: 300,                 // tăng lên cho admin thoải mái thêm chương
  message: 'Quá nhiều request, vui lòng thử lại sau.'
});
app.use('/api/', limiter);

// ==================== AUTH MIDDLEWARE ====================
const auth = (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.headers['X-API-Key'];
  if (!apiKey || apiKey !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ message: 'Unauthorized: Invalid API Key' });
  }
  next();
};

// ==================== KẾT NỐI DB ====================
const uri = process.env.MONGODB_URI;
mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB kết nối thành công'))
  .catch(err => {
    console.error('MongoDB lỗi:', err);
    process.exit(1);
  });

// Models
const Story = require('./models/story');

// Helper tạo slug không trùng
const createUniqueSlug = async (title) => {
  const baseSlug = slugify(title, { lower: true, strict: true });
  let slug = baseSlug;
  let counter = 1;
  while (await Story.findOne({ slug })) {
    slug = `${baseSlug}-${counter++}`;
  }
  return slug;
};

// ==================== ROUTES ====================

// 1. Lấy danh sách truyện
app.get('/api/stories', async (req, res) => {
  try {
    const { search, genre, page = 1 } = req.query;
    let query = {};
    if (search) query.title = { $regex: search.trim(), $options: 'i' };
    if (genre) query.genres = { $in: [genre] };

    const limit = 24;
    const stories = await Story.find(query)
      .sort({ updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select('title slug author cover genres views chapters updatedAt'); // giảm payload

    const total = await Story.countDocuments(query);

    res.json({
      stories,
      total,
      page: +page,
      hasMore: page * limit < total
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 2. Chi tiết truyện
app.get('/api/stories/:slug', async (req, res) => {
  try {
    const story = await Story.findOne({ slug: req.params.slug });
    if (!story) return res.status(404).json({ message: 'Không tìm thấy truyện' });

    story.views += 1;
    story.updatedAt = new Date();
    await story.save();

    res.json(story);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 3. Thêm truyện mới (ADMIN)
app.post('/api/stories', auth, async (req, res) => {
  try {
    let { title, author = 'Đang cập nhật', cover = '', description = '', genres = '' } = req.body;

    if (!title?.trim()) return res.status(400).json({ message: 'Thiếu tên truyện' });

    title = sanitizeHtml(title.trim(), { allowedTags: [] });
    author = sanitizeHtml(author.trim(), { allowedTags: [] });
    description = sanitizeHtml(description, { allowedTags: [] });

    let genreArray = [];
    if (genres) {
      genreArray = (Array.isArray(genres) ? genres : genres.split(','))
        .map(g => sanitizeHtml(g.trim(), { allowedTags: [] }))
        .filter(Boolean);
    }

    const slug = await createUniqueSlug(title);

    const newStory = new Story({
      title,
      author,
      cover: cover.trim(),
      description,
      genres: genreArray,
      slug
    });

    await newStory.save();

    res.status(201).json({
      message: 'Thêm truyện thành công!',
      story: newStory
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// 4. Thêm chương mới (ADMIN)
app.post('/api/stories/:slug/chapter', auth, async (req, res) => {
  try {
    const { number, title = '', type, data } = req.body;
    if (!number || !type || data === undefined) {
      return res.status(400).json({ message: 'Thiếu thông tin chương' });
    }

    const story = await Story.findOne({ slug: req.params.slug });
    if (!story) return res.status(404).json({ message: 'Không tìm thấy truyện' });

    if (story.chapters.some(ch => ch.number === +number)) {
      return res.status(400).json({ message: `Chương ${number} đã tồn tại` });
    }

    const chapterData = {
      number: +number,
      title: sanitizeHtml(title || `Chương ${number}`, { allowedTags: [] }),
    };

    if (type === 'comic') {
      chapterData.images = Array.isArray(data) ? data.filter(img => img.trim()) : [];
      chapterData.content = '';
    } else {
      chapterData.content = sanitizeHtml(data, { allowedTags: ['p', 'br', 'b', 'i', 'u', 'strong', 'em'] });
      chapterData.images = [];
    }

    story.chapters.push(chapterData);
    story.updatedAt = new Date();
    await story.save();

    res.json({ message: `Thêm chương ${number} thành công!` });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// 5. Xóa truyện (ADMIN)
app.delete('/api/stories/:slug', auth, async (req, res) => {
  try {
    const story = await Story.findOneAndDelete({ slug: req.params.slug });
    if (!story) return res.status(404).json({ message: 'Không tìm thấy truyện' });
    res.json({ message: 'Đã xóa truyện thành công!' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ==================== PHỤC VỤ ADMIN PANEL ====================
// Đảm bảo file admin.html nằm trong thư mục public/
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Phục vụ toàn bộ file tĩnh trong thư mục public (css, js, images, admin.html...)
app.use(express.static(path.join(__dirname, 'public')));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// ==================== START SERVER ====================
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server đang chạy tại http://localhost:${PORT}`);
  console.log(`Admin Panel → http://localhost:${PORT}/admin`);
  console.log(`Health check → http://localhost:${PORT}/health`);
});