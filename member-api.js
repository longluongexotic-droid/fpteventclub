(() => {
  'use strict';

  const config = window.FEV_MEMBER_CONFIG || {};
  let client;
  const pendingMessage = 'Đăng nhập thành viên đang được chuẩn bị. Vui lòng quay lại sau.';

  function failure(message, status = 503, code = 'SERVICE_UNAVAILABLE') {
    return Object.assign(new Error(message), { status, code });
  }

  function getClient() {
    if (!config.supabaseUrl || !config.publishableKey) {
      throw failure(pendingMessage, 503, 'BACKEND_NOT_CONFIGURED');
    }
    if (!window.supabase?.createClient) {
      throw failure('Không tải được dịch vụ đăng nhập. Vui lòng tải lại trang.');
    }
    if (!client) {
      const endpoint = new URL(config.supabaseUrl);
      if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) {
        throw failure(pendingMessage, 503, 'BACKEND_NOT_CONFIGURED');
      }
      client = window.supabase.createClient(endpoint.origin, config.publishableKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
          storageKey: 'fev-member-session'
        }
      });
    }
    return client;
  }

  function databaseError(error) {
    const messages = {
      FEV_UNAUTHORIZED: ['Vui lòng đăng nhập để đăng ký Ban Tổ chức.', 401],
      FEV_NOT_MEMBER: ['Tài khoản này chưa được cấp quyền thành viên FEV.', 403],
      FEV_EVENT_CLOSED: ['Sự kiện đã hết hạn hoặc không còn mở tuyển.', 409],
      FEV_INVALID_ROLE: ['Vị trí này không còn nhận đăng ký. Vui lòng chọn lại.', 400],
      FEV_INVALID_MOTIVATION: ['Phần giới thiệu cần có từ 20 đến 2.000 ký tự.', 400],
      FEV_ALREADY_APPLIED: ['Bạn đã gửi đơn cho sự kiện này. Hãy xem mục đơn đăng ký của bạn.', 409]
    };
    const entry = messages[error?.message];
    if (entry) return failure(entry[0], entry[1], error.message);
    if (error?.code === '23505') return failure(messages.FEV_ALREADY_APPLIED[0], 409, 'FEV_ALREADY_APPLIED');
    if (error?.status === 401 || error?.code === 'PGRST301') {
      return failure('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.', 401, 'SESSION_EXPIRED');
    }
    return failure('Chưa thể tải dữ liệu thành viên. Vui lòng thử lại sau.');
  }

  async function memberFor(authUser, sdk) {
    const { data, error } = await sdk.from('fev_members')
      .select('user_id,display_name,active').eq('user_id', authUser.id).maybeSingle();
    if (error) throw databaseError(error);
    if (!data?.active) {
      await sdk.auth.signOut({ scope: 'local' });
      throw failure('Tài khoản này chưa được cấp quyền thành viên FEV.', 403, 'FEV_NOT_MEMBER');
    }
    return { id: authUser.id, email: authUser.email, displayName: data.display_name || 'Thành viên FEV' };
  }

  async function currentMember(sdk) {
    const { data: sessionData, error: sessionError } = await sdk.auth.getSession();
    if (sessionError) throw databaseError(sessionError);
    if (!sessionData?.session) return null;
    // getUser verifies the token with the authentication server, rather than trusting local state.
    const { data, error } = await sdk.auth.getUser();
    if (error) {
      if (error.status === 401 || error.status === 403 || error.code === 'refresh_token_not_found') {
        await sdk.auth.signOut({ scope: 'local' });
        return null;
      }
      throw databaseError(error);
    }
    return data?.user ? memberFor(data.user, sdk) : null;
  }

  function application(row) {
    return {
      id: row.id,
      eventId: row.event_id,
      eventTitle: row.event_title || row.fev_recruitment_events?.title || 'Sự kiện FEV',
      role: row.role,
      motivation: row.motivation,
      createdAt: row.created_at,
      status: row.status
    };
  }

  async function request(path, options = {}) {
    const sdk = getClient();
    const method = (options.method || 'GET').toUpperCase();
    const body = typeof options.body === 'string' ? JSON.parse(options.body) : options.body || {};

    if (path === '/auth/me' && method === 'GET') {
      return { user: await currentMember(sdk), csrfToken: '' };
    }
    if (path === '/auth/login' && method === 'POST') {
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      if (!email || !password || password.length > 256) {
        throw failure('Vui lòng nhập email và mật khẩu hợp lệ.', 400, 'INVALID_CREDENTIALS');
      }
      const { data, error } = await sdk.auth.signInWithPassword({ email, password });
      if (error) {
        if (error.status === 429) throw failure('Bạn đã thử đăng nhập nhiều lần. Vui lòng thử lại sau ít phút.', 429, 'RATE_LIMITED');
        if (error.status >= 500 || !error.status) throw failure('Không kết nối được dịch vụ đăng nhập. Vui lòng thử lại.');
        throw failure('Email hoặc mật khẩu không đúng.', 401, 'INVALID_CREDENTIALS');
      }
      return { user: await memberFor(data.user, sdk), csrfToken: '' };
    }
    if (path === '/auth/logout' && method === 'POST') {
      const { error } = await sdk.auth.signOut({ scope: 'local' });
      if (error) throw databaseError(error);
      return { user: null };
    }
    if (path === '/recruitment' && method === 'GET') {
      const { data, error } = await sdk.from('fev_recruitment_events')
        .select('id,title,description,deadline,roles')
        .eq('is_published', true).gt('deadline', new Date().toISOString()).order('deadline');
      if (error) throw databaseError(error);
      return { events: data || [] };
    }
    if (path === '/applications') {
      const user = await currentMember(sdk);
      if (!user) throw failure('Vui lòng đăng nhập để đăng ký Ban Tổ chức.', 401, 'FEV_UNAUTHORIZED');
      if (method === 'GET') {
        const { data, error } = await sdk.from('fev_applications')
          .select('id,event_id,role,motivation,status,created_at,fev_recruitment_events(title)')
          .eq('user_id', user.id).order('created_at', { ascending: false });
        if (error) throw databaseError(error);
        return { applications: (data || []).map(application) };
      }
      if (method === 'POST') {
        const { data, error } = await sdk.rpc('fev_submit_application', {
          p_event_id: body.eventId,
          p_role: body.role,
          p_motivation: body.motivation
        });
        if (error) throw databaseError(error);
        const row = Array.isArray(data) ? data[0] : data;
        if (!row?.id) throw failure('Chưa xác nhận được đơn đăng ký. Hãy kiểm tra mục đơn của bạn trước khi gửi lại.');
        return { application: application(row) };
      }
    }
    throw failure('Không tìm thấy chức năng này.', 404, 'NOT_FOUND');
  }

  window.FEVMemberBackend = Object.freeze({
    configured: Boolean(config.supabaseUrl && config.publishableKey),
    request
  });
})();
