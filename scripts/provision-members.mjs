import { createClient } from '@supabase/supabase-js';

// Run only on a trusted administrator's computer. Never bundle this script.
const dryRun = process.argv.includes('--dry-run');
class ProvisionError extends Error {}

function required(name) {
  const value = process.env[name];
  if (!value) throw new ProvisionError(`Thiếu biến môi trường ${name}.`);
  return value;
}

function safeCode(error) {
  const code = String(error?.code || error?.status || 'unknown');
  return /^[a-zA-Z0-9_-]{1,60}$/.test(code) ? code : 'unknown';
}

function checked(result, operation) {
  if (result.error) throw new ProvisionError(`${operation} thất bại (${safeCode(result.error)}).`);
  return result.data;
}

async function main() {
  const unknownArgs = process.argv.slice(2).filter((arg) => arg !== '--dry-run');
  if (unknownArgs.length) throw new ProvisionError('Chỉ hỗ trợ tham số --dry-run.');

  const endpoint = new URL(required('SUPABASE_URL'));
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password
      || endpoint.search || endpoint.hash || endpoint.pathname !== '/') {
    throw new ProvisionError('SUPABASE_URL phải là địa chỉ gốc HTTPS của dự án.');
  }
  const serviceKey = required('SUPABASE_SERVICE_ROLE_KEY');
  const password = required('FEV_INITIAL_PASSWORD');
  if (password.length < 8) throw new ProvisionError('Mật khẩu khởi tạo phải có ít nhất 8 ký tự.');

  let roster;
  try { roster = JSON.parse(required('FEV_MEMBER_EMAILS')); }
  catch { throw new ProvisionError('FEV_MEMBER_EMAILS phải là một mảng JSON các địa chỉ email.'); }
  if (!Array.isArray(roster) || roster.length < 1 || roster.length > 100) {
    throw new ProvisionError('Danh sách thành viên phải có từ 1 đến 100 địa chỉ.');
  }
  const emails = roster.map((email) => {
    if (typeof email !== 'string') throw new ProvisionError('Mỗi phần tử trong danh sách phải là email.');
    const normalized = email.trim().toLowerCase();
    if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      throw new ProvisionError('Danh sách có địa chỉ email không hợp lệ.');
    }
    return normalized;
  });
  if (new Set(emails).size !== emails.length) throw new ProvisionError('Danh sách có email trùng lặp.');

  const supabase = createClient(endpoint.origin, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  // Verify the migration before creating any Auth accounts.
  checked(await supabase.from('fev_members').select('user_id').limit(1), 'Kiểm tra bảng thành viên');

  const targets = new Set(emails);
  const existing = new Map();
  const perPage = 1000;
  for (let page = 1; ; page += 1) {
    const data = checked(await supabase.auth.admin.listUsers({ page, perPage }), 'Đọc tài khoản');
    for (const user of data.users) {
      const email = user.email?.toLowerCase();
      if (targets.has(email)) existing.set(email, user);
    }
    if (existing.size === targets.size || data.users.length < perPage) break;
  }

  let created = 0;
  let reused = 0;
  let activated = 0;
  let unconfirmed = 0;
  for (const [index, email] of emails.entries()) {
    const memberNumber = index + 1;
    let user = existing.get(email);
    if (user) {
      reused += 1;
      if (!user.email_confirmed_at) unconfirmed += 1;
    } else if (dryRun) {
      created += 1;
      continue;
    } else {
      const data = checked(await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      }), `Tạo tài khoản số ${memberNumber}`);
      user = data.user;
      if (!user?.id) throw new ProvisionError(`Không nhận được ID tài khoản số ${memberNumber}.`);
      created += 1;
    }

    const member = checked(await supabase.from('fev_members')
      .select('user_id,display_name,active').eq('user_id', user.id).maybeSingle(),
    `Kiểm tra thành viên số ${memberNumber}`);
    if (!dryRun) {
      checked(await supabase.from('fev_members').upsert({
        user_id: user.id,
        display_name: member?.display_name || 'Thành viên FEV',
        active: true,
      }, { onConflict: 'user_id' }), `Kích hoạt thành viên số ${memberNumber}`);
      const verified = checked(await supabase.from('fev_members')
        .select('user_id,active').eq('user_id', user.id).single(),
      `Xác minh thành viên số ${memberNumber}`);
      if (!verified.active) throw new ProvisionError(`Thành viên số ${memberNumber} chưa được kích hoạt.`);
      activated += 1;
    }
  }

  console.log(JSON.stringify({
    dry_run: dryRun,
    roster_count: emails.length,
    new_accounts: created,
    existing_accounts_password_unchanged: reused,
    active_members_verified: activated,
    existing_accounts_require_email_confirmation: unconfirmed,
  }));
  if (unconfirmed) {
    console.warn('Có tài khoản cũ chưa xác nhận email; quản trị viên cần kiểm tra trong Supabase Auth.');
  }
}

main().catch((error) => {
  // Deliberately omit SDK error payloads, stack traces, email addresses and secrets.
  const safeMessage = error instanceof ProvisionError
    ? error.message : 'Không thể hoàn tất khởi tạo thành viên.';
  console.error(safeMessage);
  process.exitCode = 1;
});
