# 🎵 KINGZEVI — Music Artist Platform

Full-stack music platform: SQLite persistence, JWT auth, role-based access, and a social fan community.

## Quick Start
```bash
npm install
node server.js
# → http://localhost:3000
```

## Test Accounts
| Role   | Email                 | Password     |
|--------|-----------------------|--------------|
| Artist | artist@solace.music   | password123  |
| Fan    | fan@example.com       | password123  |
| Fan 2  | fan2@example.com      | password123  |

## Architecture
```
solace/
├── server.js              Express entry point
├── db/database.js         sql.js SQLite + schema + helpers
├── middleware/auth.js     JWT sign/verify, requireAuth, requireArtist, optionalAuth
├── routes/
│   ├── auth.js            POST /register, /login  GET /me
│   ├── music.js           Singles, albums, streams, downloads
│   └── social.js          Posts, likes, comments, image uploads
└── public/index.html      Single-page frontend
```

## API Summary
### Auth
| POST /api/auth/register | POST /api/auth/login | GET /api/auth/me |

### Music (artist-only writes)
| GET /api/music | POST /api/music | DELETE /api/music/:id |
| POST /api/music/stream/:trackId | POST /api/music/download/:id |

### Social (fans + artists)
| GET  /api/social/posts            | Paginated feed          |
| POST /api/social/posts            | Create post (auth)      |
| DELETE /api/social/posts/:id      | Own posts only          |
| POST /api/social/posts/:id/like   | Toggle like (auth)      |
| GET  /api/social/posts/:id/comments | Load comments         |
| POST /api/social/posts/:id/comments | Add comment (auth)    |
| DELETE /api/social/comments/:id   | Own comments only       |
| GET  /api/social/stats            | Community stats         |

## Roles
| Guest  | Browse music, read posts & comments                           |
| fan    | + Like, comment, create text/image posts, download music      |
| artist | + Upload music, delete own music, view artist stats           |

### Following and sharing

- Use **Follow / Following** on a post, suggested account, or public profile to follow or unfollow its author.
- Switch the community feed between **Everyone** and **Following**. Following requires sign-in.
- **Share** reposts another user's post to your profile and the community with original-author credit. **Undo share** removes your repost. Images stay on Cloudinary; reposts reference the original MongoDB post.
- Deleted originals display an unavailable message in existing reposts.
- Follow relationships and reposts use unique MongoDB indexes to prevent duplicates. Allow Mongoose to create the new indexes when deploying.

Run `npm test` for browser-DOM and isolated MongoDB regression tests. Tests mock Cloudinary uploads and do not write to the configured production database.
