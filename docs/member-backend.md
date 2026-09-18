# Backend thành viên và tuyển Ban Tổ chức

Các tệp này chuẩn bị backend Supabase. Việc có mã nguồn không có nghĩa migration đã chạy hoặc tài khoản đã được tạo trên dự án thật. Website GitHub Pages sử dụng Supabase Auth và Data API; quyền đăng ký được kiểm tra lại trong PostgreSQL.

## Triển khai

1. Chọn dự án Supabase của FEV và bật đăng nhập email/mật khẩu. Tắt tự đăng ký tài khoản công khai nếu CLB chỉ cấp tài khoản theo danh sách. Dù đăng ký Auth đang bật, tài khoản không có bản ghi thành viên đang hoạt động vẫn không thể đăng ký BTC.
2. Áp dụng `supabase/migrations/202609180001_member_recruitment.sql` bằng Supabase migrations hoặc SQL Editor của đúng dự án. Migration tạo bảng mới và chạy trong một transaction; chỉ áp dụng một lần qua lịch sử migration.
3. Đặt URL website `https://fpteventclub.io.vn` trong Auth URL Configuration. Nếu dùng quy trình khôi phục mật khẩu về sau, thêm chính xác URL callback đã triển khai, không dùng wildcard rộng.
4. Cấp các biến môi trường quản trị dưới đây qua kho bí mật hoặc phiên terminal riêng; không đưa giá trị vào Git, mã frontend, lệnh được ghi lịch sử hay ảnh chụp. Cài dependency `@supabase/supabase-js` bằng bộ quản lý package của dự án.
5. Chạy `node scripts/provision-members.mjs --dry-run` để kiểm tra danh sách; sau đó chạy `node scripts/provision-members.mjs` để tạo/kích hoạt các thành viên đã chỉ định. Script không gửi thư mời. Tài khoản mới được xác nhận email qua Admin API theo danh sách do quản trị viên cấp.
6. Cấu hình frontend với URL dự án và **publishable/anon key**. `SUPABASE_SERVICE_ROLE_KEY` chỉ được sử dụng ở môi trường quản trị, tuyệt đối không xuất hiện trong `dist/` hoặc trình duyệt.
7. Kiểm tra đăng nhập bằng các tài khoản đã cấp, quyền từ chối của khách và tài khoản không thuộc CLB, đăng ký trùng và sự kiện hết hạn trước khi công bố.

| Biến môi trường | Mục đích |
| --- | --- |
| `SUPABASE_URL` | Địa chỉ gốc HTTPS của dự án Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Khóa quản trị server; không dùng trên website |
| `FEV_MEMBER_EMAILS` | Mảng JSON các chuỗi email do quản trị viên chỉ định |
| `FEV_INITIAL_PASSWORD` | Mật khẩu chỉ áp dụng cho tài khoản mới |

Script không ghi email, mật khẩu hay khóa ra log. Nó chỉ tạo tài khoản còn thiếu, giữ nguyên mật khẩu và trạng thái xác nhận email của tài khoản Auth đã tồn tại, giữ tên hiển thị hiện có, đồng thời kích hoạt thành viên thuộc danh sách được chỉ định. Nếu một bước lỗi, các tài khoản đã tạo trước đó vẫn tồn tại; sửa lỗi rồi chạy lại với cùng danh sách sẽ tiếp tục an toàn. Không tự động xóa tài khoản khi một bước sau thất bại. Kết quả `--dry-run` chỉ là dự kiến, không chứng minh tài khoản đã được khởi tạo.

## Dữ liệu và phân quyền

- `fev_members`: ID liên kết Supabase Auth, tên hiển thị, trạng thái hoạt động. Không lưu email ở schema công khai. Thành viên chỉ đọc được hồ sơ đang hoạt động của chính mình.
- `fev_recruitment_events`: tiêu đề, mô tả, hạn đăng ký có múi giờ, danh sách vị trí tuyển, trạng thái công bố. Khách và thành viên chỉ đọc được sự kiện đã công bố.
- `fev_applications`: đơn đăng ký, vị trí, nội dung, trạng thái và thời gian. Thành viên đang hoạt động chỉ đọc được đơn của chính mình.

Vai trò `anon`/`authenticated` không có quyền INSERT, UPDATE hoặc DELETE trực tiếp trên ba bảng. Quản trị viên dùng Supabase Dashboard hoặc công cụ server với service key để quản lý sự kiện và danh sách thành viên. Chưa có trang quản trị công khai và không cấp đặc quyền quản trị cho người dùng chỉ vì họ biết mật khẩu khởi tạo.

Tạo sự kiện thật trong Table Editor với `is_published = false`, điền `title`, `description`, `deadline` và các chuỗi trong `roles`, sau đó công bố khi thông tin đã sẵn sàng. `deadline` được lưu bằng `timestamptz`; nhập kèm múi giờ, ví dụ `+07:00`. Không tạo sự kiện mẫu thành nội dung tuyển dụng thật. Sự kiện đã có đơn không thể bị xóa do khóa ngoại; ngừng tuyển bằng cách đổi trạng thái công bố hoặc hạn đăng ký.

## RPC gửi đơn

Frontend gọi `fev_submit_application` với các tham số:

```js
const { data, error } = await supabase.rpc('fev_submit_application', {
  p_event_id: eventId,
  p_role: selectedRole,
  p_motivation: motivation,
});
```

Kết quả thành công là một đối tượng JSON (không phải mảng): `id`, `user_id`, `event_id`, `event_title`, `role`, `motivation`, `status`, `created_at`. Tên trường dùng snake_case, `status` khởi tạo là `submitted`.

| SQLSTATE | Mã thông báo ổn định | Ý nghĩa |
| --- | --- | --- |
| `28000` | `FEV_UNAUTHORIZED` | Chưa đăng nhập (khách còn bị chặn bởi quyền EXECUTE) |
| `42501` | `FEV_NOT_MEMBER` | Không phải thành viên đang hoạt động |
| `22023` | `FEV_EVENT_CLOSED` | Sự kiện chưa công bố hoặc đã hết hạn |
| `22023` | `FEV_INVALID_ROLE` | Vị trí không hợp lệ |
| `22023` | `FEV_INVALID_MOTIVATION` | Nội dung ngoài 20–2000 ký tự |
| `23505` | `FEV_ALREADY_APPLIED` | Đã gửi đơn cho sự kiện đó |

RPC dùng danh tính từ `auth.uid()`, không nhận ID người dùng từ frontend. Nó kiểm tra quyền thành viên, trạng thái/hạn đăng ký, vị trí có trong danh sách tuyển và độ dài nội dung. Khóa hàng ngăn sửa sự kiện/vô hiệu hóa thành viên giữa lúc kiểm tra và gửi; ràng buộc duy nhất chặn cả hai yêu cầu đăng ký đồng thời. Hàm `SECURITY DEFINER` nằm trong schema không công khai `fev_private`, đặt `search_path = ''`, định danh đầy đủ các đối tượng và chỉ cấp EXECUTE cho vai trò `authenticated`. RPC ở `public` là wrapper `SECURITY INVOKER`; không thêm `fev_private` vào exposed schemas của Data API.

Tài liệu tham khảo: [Supabase Admin createUser](https://supabase.com/docs/reference/javascript/auth-admin-createuser), [Database functions](https://supabase.com/docs/guides/database/functions), [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security).
