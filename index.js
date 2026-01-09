// index.js - Enactus FTU Hanoi Discord Bot - FIXED VERSION
require('dotenv').config();
const { 
  Client, 
  GatewayIntentBits, 
  EmbedBuilder, 
  PermissionFlagsBits, 
  ChannelType, 
  ActionRowBuilder, 
  ModalBuilder, 
  TextInputBuilder, 
  TextInputStyle, 
  ButtonBuilder, 
  ButtonStyle,
  REST,
  Routes,
  Collection
} = require('discord.js');

// Firebase Admin SDK (đúng cho server-side)
const admin = require('firebase-admin');

// ====================
// CONFIGURATION & INIT
// ====================

console.log(`
╔══════════════════════════════════════════════════╗
║      ENACTUS FTU HANOI DISCORD BOT              ║
║            Starting up...                       ║
╚══════════════════════════════════════════════════╝
`);

// Kiểm tra biến môi trường cần thiết
const requiredEnvVars = [
  'DISCORD_TOKEN',
  'DISCORD_CLIENT_ID', 
  'DISCORD_GUILD_ID'
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingVars.length > 0) {
  console.error('❌ Missing required environment variables:', missingVars);
  console.error('Please check your .env file');
  process.exit(1);
}

// ====================
// FIREBASE INITIALIZATION
// ====================

let db = null;

try {
  // Initialize Firebase từ base64 hoặc service account
  if (process.env.FIREBASE_CREDENTIALS_BASE64) {
    // Production (Render) - dùng base64 từ env var
    const serviceAccount = JSON.parse(
      Buffer.from(process.env.FIREBASE_CREDENTIALS_BASE64, 'base64').toString()
    );
    
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log('✅ Firebase initialized from environment variable');
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    // Development - dùng service account file
    admin.initializeApp({
      credential: admin.credential.applicationDefault()
    });
    console.log('✅ Firebase initialized from service account file');
  } else {
    console.log('⚠️ Firebase not initialized - running without database');
  }
  
  if (admin.apps.length > 0) {
    db = admin.firestore();
    console.log('✅ Firebase Firestore connected');
  }
} catch (error) {
  console.error('❌ Firebase initialization error:', error.message);
  console.log('⚠️ Running without Firebase - some features may be disabled');
}

// ====================
// DISCORD CLIENT SETUP
// ====================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildModeration
  ],
  allowedMentions: {
    parse: ['users', 'roles'],
    repliedUser: true
  }
});

// Collections for data management
const pendingVerifications = new Map(); // user.id -> verification data
const verificationTimeouts = new Map(); // user.id -> timeout reference
const userCooldowns = new Map(); // user.id -> last command timestamp

// ====================
// UTILITY FUNCTIONS
// ====================

/**
 * Format date to Vietnamese locale
 */
function formatDate(dateString) {
  if (!dateString) return 'Chưa cập nhật';
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  } catch (error) {
    return 'Chưa cập nhật';
  }
}

/**
 * Format time remaining
 */
function formatTimeRemaining(ms) {
  if (ms <= 0) return 'Đã hết hạn';
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours} giờ ${minutes} phút`;
}

/**
 * Create a verification channel for a user
 */
async function createVerificationChannel(member) {
  try {
    const guild = member.guild;
    
    // Find or create VERIFICATION category
    let verificationCategory = guild.channels.cache.find(
      channel => channel.name === '📋-verification' && channel.type === ChannelType.GuildCategory
    );
    
    if (!verificationCategory) {
      verificationCategory = await guild.channels.create({
        name: '📋-verification',
        type: ChannelType.GuildCategory,
        permissionOverwrites: [
          {
            id: guild.roles.everyone.id,
            deny: [PermissionFlagsBits.ViewChannel]
          },
          {
            id: client.user.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.ManageChannels,
              PermissionFlagsBits.ManageRoles
            ]
          }
        ],
        reason: 'Auto-created for member verification'
      });
      console.log(`📁 Created verification category: ${verificationCategory.name}`);
    }
    
    // Create user-specific verification channel
    const channelName = `verify-${member.user.username.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
    const verifyChannel = await guild.channels.create({
      name: channelName.substring(0, 100),
      type: ChannelType.GuildText,
      parent: verificationCategory.id,
      topic: `Verification for ${member.user.tag} | ID: ${member.id}`,
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          deny: [PermissionFlagsBits.ViewChannel]
        },
        {
          id: member.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.EmbedLinks
          ]
        },
        {
          id: client.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ManageMessages,
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.EmbedLinks,
            PermissionFlagsBits.AttachFiles
          ]
        }
      ],
      reason: `Verification channel for ${member.user.tag}`
    });
    
    console.log(`📝 Created verification channel for ${member.user.tag}`);
    return verifyChannel;
    
  } catch (error) {
    console.error(`❌ Failed to create verification channel for ${member.user.tag}:`, error);
    throw error;
  }
}

/**
 * Find member in Firebase by email
 */
async function findMemberByEmail(email) {
  if (!db) {
    console.log('⚠️ Firebase not available - cannot search members');
    return null;
  }
  
  try {
    const normalizedEmail = email.toLowerCase().trim();
    const membersRef = db.collection("members");
    const snapshot = await membersRef.where("email", "==", normalizedEmail).get();
    
    if (snapshot.empty) {
      return null;
    }
    
    const userDoc = snapshot.docs[0];
    const userData = userDoc.data();
    
    return {
      docId: userDoc.id,
      ...userData,
      name: userData.name || 'Chưa cập nhật',
      ban: userData.ban || 'Chưa xác định',
      role: userData.role || 'Member',
      id: userData.id || 'Không có',
      process: userData.process || 'Active'
    };
    
  } catch (error) {
    console.error('❌ Error searching Firebase:', error);
    return null;
  }
}

/**
 * Update Discord info in Firebase
 */
async function updateDiscordInfo(docId, discordData) {
  if (!db) {
    console.log('⚠️ Firebase not available - cannot update info');
    return false;
  }
  
  try {
    const memberRef = db.collection("members").doc(docId);
    await memberRef.update({
      discord_id: discordData.id,
      discord_username: discordData.tag,
      discord_display_name: discordData.displayName,
      verified_at: admin.firestore.FieldValue.serverTimestamp(),
      verified: true,
      last_updated: admin.firestore.FieldValue.serverTimestamp()
    });
    return true;
  } catch (error) {
    console.error('❌ Error updating Firebase:', error);
    return false;
  }
}

/**
 * Check if user has cooldown
 */
function checkCooldown(userId, command, cooldownSeconds = 5) {
  const now = Date.now();
  const userCooldown = userCooldowns.get(userId) || {};
  const lastUsed = userCooldown[command] || 0;
  
  if (now - lastUsed < cooldownSeconds * 1000) {
    const remaining = Math.ceil((cooldownSeconds * 1000 - (now - lastUsed)) / 1000);
    return remaining;
  }
  
  userCooldown[command] = now;
  userCooldowns.set(userId, userCooldown);
  return 0;
}

// ====================
// EMBED BUILDERS
// ====================

/**
 * Create welcome embed
 */
function createWelcomeEmbed(member) {
  return new EmbedBuilder()
    .setColor('#00B0F4')
    .setTitle(`🎉 Chào mừng ${member.user.username} đến với Enactus FTU Hà Nội!`)
    .setDescription(`Xin chào <@${member.id}>, chào mừng bạn đến với cộng đồng Enactus FTU Hanoi!`)
    .addFields(
      { name: '📋 **Bước 1**', value: 'Vào kênh #verify', inline: true },
      { name: '🔐 **Bước 2**', value: 'Dùng lệnh `/verify`', inline: true },
      { name: '📧 **Bước 3**', value: 'Nhập email Enactus của bạn', inline: true },
      { 
        name: '⏰ **Lưu ý quan trọng**', 
        value: 'Bạn có **2 giờ** để hoàn tất xác minh. Sau thời gian này, bạn sẽ bị tự động rời khỏi server.', 
        inline: false 
      }
    )
    .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
    .setFooter({ 
      text: 'Enactus FTU Hanoi | Hệ thống xác minh tự động'
    })
    .setTimestamp();
}

/**
 * Create verification info embed
 */
function createVerificationInfoEmbed(userData, email) {
  return new EmbedBuilder()
    .setColor('#FF9800')
    .setTitle('🔍 XÁC NHẬN THÔNG TIN THÀNH VIÊN')
    .setDescription(`Xin chào **${userData.name}**!\n\nVui lòng kiểm tra kỹ thông tin bên dưới trước khi xác nhận:`)
    .addFields(
      { 
        name: '👤 **THÔNG TIN CÁ NHÂN**', 
        value: `**Họ tên:** ${userData.name}\n**Email:** ${email}\n**Mã thành viên:** ${userData.id}`,
        inline: false 
      },
      { 
        name: '🏛️ **THÔNG TIN ENACTUS**', 
        value: `**Ban:** ${userData.ban}\n**Vai trò:** ${userData.role}\n**Trạng thái:** ${userData.process}`,
        inline: false 
      }
    )
    .setFooter({ 
      text: 'Enactus FTU Hà Nội • Vui lòng xác nhận trong 10 phút'
    })
    .setTimestamp();
}

/**
 * Create success embed
 */
function createSuccessEmbed(member, userData, roleName) {
  return new EmbedBuilder()
    .setColor('#4CAF50')
    .setTitle('✅ XÁC MINH THÀNH CÔNG!')
    .setDescription(`**Chào mừng ${userData.name} đến với Enactus FTU Hà Nội Discord Server!**`)
    .addFields(
      { name: '🎉 **CHÚC MỪNG**', value: 'Bạn đã được xác minh thành công và đã nhận đầy đủ quyền truy cập!', inline: false },
      { name: '🏷️ **ROLE ĐÃ NHẬN**', value: `\`${roleName}\``, inline: true },
      { name: '🏛️ **BAN**', value: userData.ban, inline: true },
      { name: '📋 **VAI TRÒ**', value: userData.role, inline: true }
    )
    .setThumbnail(member.user.displayAvatarURL({ size: 128 }))
    .setFooter({ 
      text: 'Enactus FTU Hanoi - Chào mừng thành viên mới!'
    })
    .setTimestamp();
}

// ====================
// EVENT HANDLERS
// ====================

/**
 * Bot ready event
 */
client.once('ready', async () => {
  console.log(`
╔══════════════════════════════════════════════════╗
║      BOT IS READY!                               ║
║      Logged in as: ${client.user.tag.padEnd(22)}║
║      Guilds: ${client.guilds.cache.size.toString().padEnd(27)}║
║      Users: ${client.users.cache.size.toString().padEnd(28)}║
╚══════════════════════════════════════════════════╝
  `);
  
  // Register slash commands
  await registerCommands();
  
  // Start periodic checks
  setInterval(checkUnverifiedMembers, 15 * 60 * 1000);
  
  // Set bot status
  client.user.setPresence({
    activities: [{
      name: '/verify để xác minh',
      type: 3 // WATCHING
    }],
    status: 'online'
  });
  
  // Log guild info
  client.guilds.cache.forEach(guild => {
    console.log(`🏠 ${guild.name} (${guild.id}) - ${guild.memberCount} members`);
  });
});

/**
 * Guild member add event
 */
client.on('guildMemberAdd', async (member) => {
  console.log(`👤 New member: ${member.user.tag} (${member.id})`);
  
  try {
    // Assign Visitor role
    const visitorRole = member.guild.roles.cache.find(role => 
      role.name.toLowerCase() === 'visitor' || 
      role.name.toLowerCase() === 'new member'
    );
    
    if (visitorRole) {
      await member.roles.add(visitorRole);
      console.log(`✅ Added ${visitorRole.name} role to ${member.user.tag}`);
    }
    
    // Send welcome message to general channel
    const generalChannel = member.guild.channels.cache.find(channel => 
      channel.name.includes('general') && 
      channel.type === ChannelType.GuildText
    );
    
    if (generalChannel) {
      const welcomeEmbed = createWelcomeEmbed(member);
      await generalChannel.send({ 
        content: `Chào mừng <@${member.id}>! 🎉`,
        embeds: [welcomeEmbed] 
      });
    }
    
    // Set verification timeout (2 hours)
    const timeout = setTimeout(async () => {
      await handleVerificationTimeout(member);
    }, 2 * 60 * 60 * 1000);
    
    verificationTimeouts.set(member.id, timeout);
    
  } catch (error) {
    console.error(`❌ Error processing new member ${member.user.tag}:`, error);
  }
});

/**
 * Handle verification timeout
 */
async function handleVerificationTimeout(member) {
  try {
    const freshMember = await member.guild.members.fetch(member.id).catch(() => null);
    if (!freshMember) return;
    
    const isVerified = freshMember.roles.cache.some(role => 
      role.name === 'Enactus Member' || 
      role.name === 'Member' ||
      role.name === 'Verified'
    );
    
    if (!isVerified) {
      console.log(`⏰ Verification timeout for ${member.user.tag}, kicking...`);
      
      try {
        await member.send({
          embeds: [
            new EmbedBuilder()
              .setColor('#F44336')
              .setTitle('⏰ HẾT THỜI GIAN XÁC MINH')
              .setDescription('Rất tiếc, bạn đã bị tự động rời khỏi server vì không hoàn thành xác minh trong 2 giờ.')
              .setFooter({ text: 'Enactus FTU Hanoi' })
              .setTimestamp()
          ]
        });
      } catch (dmError) {}
      
      await member.kick('Không hoàn thành xác minh trong 2 giờ');
      console.log(`🚫 Kicked ${member.user.tag} - Verification timeout`);
      
      // Clean up
      pendingVerifications.delete(member.id);
      verificationTimeouts.delete(member.id);
    }
  } catch (error) {
    console.error(`❌ Error in timeout handler for ${member.user.tag}:`, error);
  }
}

// ====================
// SLASH COMMAND HANDLERS
// ====================

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  
  const { commandName, user } = interaction;
  
  // Check cooldown
  const cooldownRemaining = checkCooldown(user.id, commandName, 10);
  if (cooldownRemaining > 0) {
    await interaction.reply({
      content: `⏳ Vui lòng đợi ${cooldownRemaining} giây trước khi dùng lệnh này lại.`,
      ephemeral: true
    });
    return;
  }
  
  console.log(`🔄 Command: /${commandName} by ${user.tag} (${user.id})`);
  
  try {
    switch (commandName) {
      case 'verify':
        await handleVerifyCommand(interaction);
        break;
      case 'status':
        await handleStatusCommand(interaction);
        break;
      case 'help':
        await handleHelpCommand(interaction);
        break;
      default:
        await interaction.reply({
          content: '❌ Lệnh không được nhận diện.',
          ephemeral: true
        });
    }
  } catch (error) {
    console.error(`❌ Error handling command /${commandName}:`, error);
    await interaction.reply({
      content: '❌ Đã xảy ra lỗi khi xử lý lệnh. Vui lòng thử lại sau.',
      ephemeral: true
    });
  }
});

async function handleVerifyCommand(interaction) {
  const member = interaction.guild.members.cache.get(interaction.user.id);
  
  // Check if already verified
  const memberRole = interaction.guild.roles.cache.find(role => 
    role.name === 'Enactus Member' || 
    role.name === 'Member' ||
    role.name === 'Verified'
  );
  
  if (memberRole && member.roles.cache.has(memberRole.id)) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor('#4CAF50')
          .setTitle('✅ ĐÃ XÁC MINH')
          .setDescription(`Bạn đã được xác minh rồi!\n\nRole hiện tại: **${memberRole.name}**`)
          .setFooter({ text: 'Enactus FTU Hanoi' })
          .setTimestamp()
      ],
      ephemeral: true
    });
    return;
  }
  
  // Create verification modal
  const modal = new ModalBuilder()
    .setCustomId('verifyModal')
    .setTitle('🔐 Xác minh Enactus FTU');
  
  const emailInput = new TextInputBuilder()
    .setCustomId('enactusEmail')
    .setLabel('Nhập email Enactus của bạn')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('example@enactusftu... hoặc ...@enactus.org')
    .setRequired(true)
    .setMinLength(5)
    .setMaxLength(100);
  
  const actionRow = new ActionRowBuilder().addComponents(emailInput);
  modal.addComponents(actionRow);
  
  await interaction.showModal(modal);
}

async function handleStatusCommand(interaction) {
  const member = interaction.guild.members.cache.get(interaction.user.id);
  const visitorRole = interaction.guild.roles.cache.find(role => 
    role.name.toLowerCase() === 'visitor'
  );
  const memberRole = interaction.guild.roles.cache.find(role => 
    role.name === 'Enactus Member' || 
    role.name === 'Member'
  );
  
  let description = '';
  let color = 0x000000;
  
  if (memberRole && member.roles.cache.has(memberRole.id)) {
    description = `✅ **Bạn đã được xác minh thành công!**\n\n🏷️ **Role:** ${memberRole.name}\n📅 **Tham gia:** ${new Date(member.joinedTimestamp).toLocaleDateString('vi-VN')}`;
    color = 0x4CAF50;
  } else if (visitorRole && member.roles.cache.has(visitorRole.id)) {
    const timeLeft = 2 * 60 * 60 * 1000 - (Date.now() - member.joinedTimestamp);
    const timeLeftFormatted = formatTimeRemaining(timeLeft);
    
    description = `⚠️ **Bạn chưa được xác minh!**\n\n⏳ **Thời gian còn lại:** ${timeLeftFormatted}\n📅 **Tham gia:** ${new Date(member.joinedTimestamp).toLocaleDateString('vi-VN')}\n\n🔐 **Hành động cần thiết:** Dùng lệnh \`/verify\` để bắt đầu xác minh.`;
    color = 0xFF9800;
  } else {
    description = '❓ **Trạng thái không xác định.**\n\nVui lòng liên hệ quản trị viên để được hỗ trợ.';
    color = 0xF44336;
  }
  
  const statusEmbed = new EmbedBuilder()
    .setColor(color)
    .setTitle('📊 TRẠNG THÁI XÁC MINH')
    .setDescription(description)
    .setThumbnail(member.user.displayAvatarURL({ size: 64 }))
    .setFooter({ text: 'Enactus FTU Hanoi' })
    .setTimestamp();
  
  await interaction.reply({
    embeds: [statusEmbed],
    ephemeral: true
  });
}

async function handleHelpCommand(interaction) {
  const helpEmbed = new EmbedBuilder()
    .setColor('#2196F3')
    .setTitle('🆘 HƯỚNG DẪN SỬ DỤNG BOT')
    .setDescription('Danh sách các lệnh và hướng dẫn chi tiết:')
    .addFields(
      { 
        name: '🔐 **/verify**', 
        value: 'Bắt đầu quá trình xác minh thành viên Enactus FTU\nNhập email Enactus để kiểm tra thông tin',
        inline: false 
      },
      { 
        name: '📊 **/status**', 
        value: 'Kiểm tra trạng thái xác minh của bạn',
        inline: false 
      },
      { 
        name: '📋 **QUY TRÌNH XÁC MINH**', 
        value: '1. Dùng lệnh `/verify`\n2. Nhập email Enactus của bạn\n3. Kiểm tra thông tin hiển thị\n4. Xác nhận thông tin chính xác\n5. Nhận role và quyền truy cập',
        inline: false 
      },
      { 
        name: '⏰ **THỜI HẠN**', 
        value: '2 giờ kể từ khi tham gia server\nSau thời gian này, tài khoản chưa xác minh sẽ bị tự động xóa',
        inline: false 
      }
    )
    .setFooter({ 
      text: 'Enactus FTU Hanoi - Hệ thống xác minh tự động'
    })
    .setTimestamp();
  
  await interaction.reply({
    embeds: [helpEmbed],
    ephemeral: true
  });
}

// ====================
// MODAL & BUTTON HANDLERS
// ====================

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isModalSubmit()) return;
  
  if (interaction.customId === 'verifyModal') {
    await interaction.deferReply({ ephemeral: true });
    
    const email = interaction.fields.getTextInputValue('enactusEmail').trim();
    const member = interaction.guild.members.cache.get(interaction.user.id);
    
    console.log(`📧 Verification attempt: ${member.user.tag} - ${email}`);
    
    // Basic email validation
    if (!email.toLowerCase().includes('enactus')) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor('#F44336')
            .setTitle('❌ EMAIL KHÔNG HỢP LỆ')
            .setDescription('Email phải là email Enactus FTU (chứa từ **"enactus"**).')
            .addFields(
              { name: '📧 Email đã nhập', value: email },
              { name: '✅ Ví dụ email hợp lệ', value: 'name@enactusftu...\nname@enactus.org\n...enactus...' }
            )
            .setFooter({ text: 'Vui lòng thử lại với email Enactus chính xác' })
            .setTimestamp()
        ]
      });
      return;
    }
    
    try {
      // Search in Firebase
      const memberData = await findMemberByEmail(email);
      
      if (!memberData) {
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor('#F44336')
              .setTitle('❌ EMAIL KHÔNG TỒN TẠI')
              .setDescription('Email này không tồn tại trong hệ thống Enactus FTU.')
              .addFields(
                { name: '📧 Email đã nhập', value: email },
                { name: '🔍 Kiểm tra lại', value: 'Vui lòng kiểm tra lại email hoặc liên hệ Ban Kỹ thuật nếu email chính xác.' }
              )
              .setFooter({ text: 'Enactus FTU Hanoi - Ban Kỹ thuật' })
              .setTimestamp()
          ]
        });
        return;
      }
      
      // Check account status
      if (memberData.process !== 'Active') {
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor('#F44336')
              .setTitle('❌ TÀI KHOẢN KHÔNG HOẠT ĐỘNG')
              .setDescription(`Tài khoản của bạn đang ở trạng thái: **${memberData.process}**.`)
              .addFields(
                { name: '📧 Email', value: email },
                { name: '👤 Tên', value: memberData.name },
                { name: '🔧 Hỗ trợ', value: 'Vui lòng liên hệ Ban Kỹ thuật để được hỗ trợ.' }
              )
              .setFooter({ text: 'Enactus FTU Hanoi' })
              .setTimestamp()
          ]
        });
        return;
      }
      
      // Create verification channel
      const verifyChannel = await createVerificationChannel(member);
      
      // Store verification data
      pendingVerifications.set(member.id, {
        email: email,
        userData: memberData,
        channelId: verifyChannel.id,
        guildId: interaction.guild.id,
        docId: memberData.docId,
        createdAt: Date.now()
      });
      
      // Send verification info to channel
      const infoEmbed = createVerificationInfoEmbed(memberData, email);
      
      const confirmButtons = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('confirm_yes')
            .setLabel('✅ XÁC NHẬN ĐÚNG')
            .setStyle(ButtonStyle.Success)
            .setEmoji('✅'),
          new ButtonBuilder()
            .setCustomId('confirm_no')
            .setLabel('❌ THÔNG TIN SAI')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('❌')
        );
      
      await verifyChannel.send({
        content: `${member}, **CHÀO MỪNG BẠN ĐẾN VỚI QUÁ TRÌNH XÁC MINH ENACTUS FTU!**\n\nVui lòng kiểm tra kỹ thông tin bên dưới:`,
        embeds: [infoEmbed],
        components: [confirmButtons]
      });
      
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor('#4CAF50')
            .setTitle('✅ KÊNH XÁC MINH ĐÃ ĐƯỢC TẠO')
            .setDescription(`Đã tạo kênh xác minh riêng cho bạn: ${verifyChannel}`)
            .addFields(
              { name: '📁 Kênh', value: `${verifyChannel}` },
              { name: '⏳ Thời gian', value: 'Vui lòng xác nhận trong vòng 10 phút' }
            )
            .setFooter({ text: 'Enactus FTU Hanoi' })
            .setTimestamp()
        ]
      });
      
    } catch (error) {
      console.error(`❌ Error in verification for ${member.user.tag}:`, error);
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor('#F44336')
            .setTitle('❌ LỖI HỆ THỐNG')
            .setDescription('Đã xảy ra lỗi khi xử lý yêu cầu xác minh.')
            .addFields(
              { name: '📧 Email', value: email },
              { name: '🔧 Hỗ trợ', value: 'Vui lòng thử lại sau hoặc liên hệ Ban Kỹ thuật.' }
            )
            .setFooter({ text: 'Enactus FTU Hanoi - Ban Kỹ thuật' })
            .setTimestamp()
        ]
      });
    }
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;
  
  const member = interaction.guild.members.cache.get(interaction.user.id);
  const pendingData = pendingVerifications.get(member.id);
  
  if (!pendingData) {
    await interaction.reply({ 
      content: '❌ Phiên xác minh không tồn tại hoặc đã hết hạn. Vui lòng bắt đầu lại với `/verify`.',
      ephemeral: true 
    });
    return;
  }
  
  if (interaction.customId === 'confirm_yes') {
    try {
      // Clear verification timeout
      const timeout = verificationTimeouts.get(member.id);
      if (timeout) {
        clearTimeout(timeout);
        verificationTimeouts.delete(member.id);
      }
      
      // Update Firebase with Discord info
      await updateDiscordInfo(pendingData.docId, {
        id: member.id,
        tag: member.user.tag,
        displayName: member.displayName
      });
      
      // Assign roles
      let primaryRole = interaction.guild.roles.cache.find(role => 
        role.name === pendingData.userData.ban
      );
      
      if (!primaryRole) {
        primaryRole = interaction.guild.roles.cache.find(role => 
          role.name === 'Enactus Member' || 
          role.name === 'Member'
        );
      }
      
      if (primaryRole) {
        await member.roles.add(primaryRole);
        
        // Assign position role if exists
        if (pendingData.userData.role && pendingData.userData.role !== 'Member') {
          const positionRole = interaction.guild.roles.cache.find(role => 
            role.name === pendingData.userData.role
          );
          if (positionRole) {
            await member.roles.add(positionRole);
          }
        }
      }
      
      // Remove Visitor role
      const visitorRole = interaction.guild.roles.cache.find(role => 
        role.name.toLowerCase() === 'visitor'
      );
      if (visitorRole) {
        await member.roles.remove(visitorRole);
      }
      
      // Send success message
      const successEmbed = createSuccessEmbed(member, pendingData.userData, primaryRole?.name || 'Enactus Member');
      
      await interaction.update({
        content: `🎉 **${member.user.username} ĐÃ XÁC MINH THÀNH CÔNG!**`,
        embeds: [successEmbed],
        components: []
      });
      
      // Delete verification channel after 10 minutes
      setTimeout(async () => {
        try {
          const channel = interaction.guild.channels.cache.get(pendingData.channelId);
          if (channel) {
            await channel.delete();
            console.log(`🗑️ Deleted verification channel for ${member.user.tag}`);
          }
        } catch (error) {}
      }, 10 * 60 * 1000);
      
      // Clean up
      pendingVerifications.delete(member.id);
      
      console.log(`✅ ${member.user.tag} verified successfully as ${pendingData.userData.ban}/${pendingData.userData.role}`);
      
    } catch (error) {
      console.error(`❌ Error confirming verification for ${member.user.tag}:`, error);
      await interaction.reply({
        content: '❌ Đã xảy ra lỗi khi xác nhận. Vui lòng liên hệ Ban Kỹ thuật.',
        ephemeral: true
      });
    }
  }
  
  if (interaction.customId === 'confirm_no') {
    const errorEmbed = new EmbedBuilder()
      .setColor('#F44336')
      .setTitle('❌ THÔNG TIN KHÔNG CHÍNH XÁC')
      .setDescription('Thông tin hiển thị không khớp với tài khoản của bạn.')
      .addFields(
        { name: '📧 Email đã nhập', value: pendingData.email },
        { name: '🔧 Hỗ trợ', value: 'Vui lòng liên hệ Ban Kỹ thuật với email Enactus chính xác của bạn.' }
      )
      .setFooter({ text: 'Enactus FTU Hanoi - Ban Kỹ thuật' })
      .setTimestamp();
    
    await interaction.update({
      embeds: [errorEmbed],
      components: []
    });
    
    // Delete channel after 5 minutes
    setTimeout(async () => {
      try {
        const channel = interaction.guild.channels.cache.get(pendingData.channelId);
        if (channel) {
          await channel.delete();
        }
      } catch (error) {}
    }, 5 * 60 * 1000);
    
    pendingVerifications.delete(member.id);
  }
});

// ====================
// PERIODIC CHECKS
// ====================

/**
 * Check for unverified members
 */
async function checkUnverifiedMembers() {
  try {
    const guild = client.guilds.cache.get(process.env.DISCORD_GUILD_ID);
    if (!guild) return;
    
    const members = await guild.members.fetch();
    const visitorRole = guild.roles.cache.find(role => 
      role.name.toLowerCase() === 'visitor'
    );
    
    if (!visitorRole) return;
    
    const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000);
    const unverifiedMembers = members.filter(member => 
      member.roles.cache.has(visitorRole.id) && 
      !member.user.bot &&
      member.joinedTimestamp < twoHoursAgo
    );
    
    console.log(`🔍 Periodic check: ${unverifiedMembers.size} unverified members`);
    
    for (const member of unverifiedMembers.values()) {
      await handleVerificationTimeout(member);
    }
  } catch (error) {
    console.error('❌ Error in periodic check:', error);
  }
}

// ====================
// COMMAND REGISTRATION
// ====================

async function registerCommands() {
  try {
    const commands = [
      {
        name: 'verify',
        description: 'Xác minh thành viên Enactus FTU'
      },
      {
        name: 'status',
        description: 'Kiểm tra trạng thái xác minh của bạn'
      },
      {
        name: 'help',
        description: 'Hiển thị hướng dẫn sử dụng bot'
      }
    ];
    
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    
    console.log('🔄 Registering slash commands...');
    
    await rest.put(
      Routes.applicationGuildCommands(
        process.env.DISCORD_CLIENT_ID,
        process.env.DISCORD_GUILD_ID
      ),
      { body: commands }
    );
    
    console.log('✅ Slash commands registered successfully!');
    
  } catch (error) {
    console.error('❌ Failed to register commands:', error);
  }
}

// ====================
// ERROR HANDLING
// ====================

process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled Promise Rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
});

client.on('error', (error) => {
  console.error('❌ Discord client error:', error);
});

client.on('warn', (info) => {
  console.warn('⚠️ Discord warning:', info);
});

// ====================
// BOT LOGIN
// ====================

client.login(process.env.DISCORD_TOKEN)
  .then(() => {
    console.log('🔐 Bot login initiated...');
  })
  .catch(error => {
    console.error('❌ Login failed:', error);
    process.exit(1);
  });

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down bot gracefully...');
  client.destroy();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Terminating bot...');
  client.destroy();
  process.exit(0);
});