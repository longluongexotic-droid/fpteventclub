// Public browser-only login configuration. This is NOT a security boundary.
// Hashes avoid publishing plaintext credentials; the entire gate is still bypassable.
window.FEV_MEMBER_CONFIG = Object.freeze({
  accounts: Object.freeze([
    Object.freeze({
      id: 'fev-member-1',
      emailHash: '2a6b9a045b6d61302d8094e80fa6e92a987a26ea943882ee3013d6a4ff329c6f',
      salt: '40a4d5d08e1875d350ec70de6274455d',
      passwordHash: '119edeabb4e46981df96669866f288893f5b01679b6ea526cf2f461cfcbf7134'
    }),
    Object.freeze({
      id: 'fev-member-2',
      emailHash: '8f280ec86a03b76f4976d091e8e323c15304297e32f3d7da3f7080c1ef6a85ce',
      salt: 'bca8a4eac2e37e9c75803f4a1d60a2a8',
      passwordHash: 'be6770b76ffa8002917f772172f50b0a51548b3ea900619fc93e0d61966b3574'
    })
  ]),
  // Confirmed events: id, title, description, deadline, roles, applicationUrl.
  // Registration links must use HTTPS. They are public, not protected resources.
  events: Object.freeze([])
});
