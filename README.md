# FPT Event Club — The Way We Went

Website tĩnh HTML/CSS/JavaScript với Supabase Auth và PostgreSQL. Giao diện giữ tông tím–đen–đỏ và font Montserrat. Xác thực, vai trò, dữ liệu sự kiện và đơn ứng tuyển được kiểm soát bằng Supabase và RLS.

Bản đang chạy: [fpteventclub.io.vn](https://fpteventclub.io.vn/) trên GitHub Pages. Google OAuth đã nối với Supabase; mã nguồn và 99 sự kiện được triển khai tự động từ nhánh `main`.

## Bắt đầu

Xem [sơ đồ kiến trúc và hướng dẫn thiết lập/deploy](docs/architecture-and-deploy.md) trước. File SQL tạo database là [`supabase/migrations/202610010001_fev_platform.sql`](supabase/migrations/202610010001_fev_platform.sql); [`supabase/seed_events.sql`](supabase/seed_events.sql) nhập 99 sự kiện lịch sử. Migration cần chạy trên Supabase và Auth hook cần bật trong Dashboard trước khi frontend có thể đăng nhập đúng quy trình.

```powershell
$env:SUPABASE_URL = 'https://PROJECT_REF.supabase.co'
$env:SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_...'
$env:REQUIRE_SUPABASE_CONFIG = '1'
node scripts/build-static.mjs
node server.mjs
```

Mở `http://127.0.0.1:4173`. `dist/` là bản build được deploy; không chỉnh trực tiếp. `node --test tests/*.test.mjs` kiểm tra migration/RLS trên PostgreSQL mô phỏng. Kiểm thử OAuth và Data API thật cần Supabase project đã cấu hình.

Để chạy kiểm thử trong checkout mới, cài dependencies bằng `pnpm install --frozen-lockfile` trước.

## Cấu trúc

- `index.html`: trang chủ.
- `su-kien.html`, `events.js`, `events.css`: kho sự kiện từ database, tìm theo tên và lọc năm/loại.
- `dang-nhap.html`, `member.js`, `supabase-client.js`: Google OAuth sinh viên, email/password quản trị, session và header.
- `tuyen-ban-to-chuc.html`, `recruitment.js`, `recruitment.css`: đợt tuyển, form trực tiếp và trạng thái đơn.
- `quan-tri.html`, `admin.js`, `admin.css`: giao diện quản trị sự kiện và đơn.
- `chinh-sach-quyen-rieng-tu.html`, `privacy.css`: chính sách dữ liệu công khai cho người dùng và Google OAuth.
- `styles.css`, `member.css`, `app.js`: design system, layout, tương tác chung.
- `scripts/build-static.mjs`: build danh sách file public và chèn URL/anon key vào bản tĩnh.

Chỉ URL và publishable/anon key của Supabase có mặt trên website. **Không đưa service role key, Google Client Secret, dữ liệu riêng tư hoặc mật khẩu vào Git hay frontend.** Các hash mật khẩu từng nằm trong bản web cũ đã là dữ liệu công khai; mọi mật khẩu từng dùng ở đó hoặc được dùng lại cần đổi trước khi tạo tài khoản Supabase.
