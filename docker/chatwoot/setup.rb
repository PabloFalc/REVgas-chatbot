admin_email = ENV.fetch('CW_ADMIN_EMAIL', 'admin@revgas.local')
account_name = ENV.fetch('CW_ACCOUNT_NAME', 'RevGás Local')
webhook = ENV.fetch('CW_WEBHOOK_URL', 'http://host.docker.internal:3100/webhooks/chatwoot')
agent_emails = ENV.fetch('CW_AGENT_EMAILS', '').split(',').map { |e| e.strip.downcase }.reject(&:empty?).uniq
agent_password = ENV['CW_AGENT_PASSWORD'].to_s
abort 'CW_AGENT_PASSWORD é obrigatória quando CW_AGENT_EMAILS não está vazia' if agent_emails.any? && agent_password.empty?

preset = { api: ENV['CW_API_TOKEN'].to_s, bot: ENV['CW_BOT_TOKEN'].to_s, secret: ENV['CW_WEBHOOK_SECRET'].to_s }
preset_mode = preset.values.none?(&:empty?)
abort 'Informe CW_API_TOKEN, CW_BOT_TOKEN e CW_WEBHOOK_SECRET juntas ou nenhuma' if !preset_mode && preset.values.any? { |v| !v.empty? }
abort 'CW_API_TOKEN e CW_BOT_TOKEN precisam ter ao menos 20 caracteres' if preset_mode && (preset[:api].length < 20 || preset[:bot].length < 20)
abort 'CW_WEBHOOK_SECRET precisa ter ao menos 16 caracteres' if preset_mode && preset[:secret].length < 16
abort 'CW_API_TOKEN e CW_BOT_TOKEN devem ser diferentes' if preset_mode && preset[:api] == preset[:bot]

ActiveRecord::Base.transaction do
  user = User.find_by(email: admin_email)
  unless user
    password = ENV['CW_ADMIN_PASSWORD'].to_s
    abort 'CW_ADMIN_PASSWORD é obrigatória quando o administrador ainda não existe' if password.empty?
    user = User.new(name: 'Admin Local', email: admin_email, password: password, password_confirmation: password)
    user.skip_confirmation!
    user.save!
  end
  user.confirm if user.confirmed_at.nil?

  account = Account.find_by(name: account_name) || Account.create!(name: account_name)
  AccountUser.find_or_create_by!(account: account, user: user) { |au| au.role = :administrator }
  au = AccountUser.find_by!(account: account, user: user)
  au.update!(role: :administrator) unless au.administrator?

  if account.custom_attributes.key?('onboarding_step')
    account.custom_attributes.delete('onboarding_step')
    account.save!
  end

  inbox = account.inboxes.find_by(name: 'WhatsApp Bot', channel_type: 'Channel::Api')
  inbox ||= Inbox.create!(
    account: account, name: 'WhatsApp Bot', enable_auto_assignment: false,
    channel: Channel::Api.create!(account: account, webhook_url: webhook)
  )
  inbox.channel.update!(webhook_url: webhook) if inbox.channel.webhook_url != webhook
  inbox.update!(enable_auto_assignment: false) if inbox.enable_auto_assignment

  agent_emails.each do |email|
    agent = User.find_by(email: email)
    unless agent
      agent = User.new(name: email.split('@').first, email: email, password: agent_password, password_confirmation: agent_password)
      agent.skip_confirmation!
      agent.save!
    end
    agent.confirm if agent.confirmed_at.nil?
    AccountUser.find_or_create_by!(account: account, user: agent) { |a| a.role = :agent }
    InboxMember.find_or_create_by!(inbox: inbox, user: agent)
  end

  bot = AgentBot.find_by(account_id: account.id, name: 'RevGás Bot') ||
        AgentBot.create!(account: account, name: 'RevGás Bot', description: 'Remetente das mensagens do bot (local)')

  ::Redis::Alfred.delete(::Redis::Alfred::CHATWOOT_INSTALLATION_ONBOARDING)

  if preset_mode
    user.access_token.update!(token: preset[:api]) unless user.access_token.token == preset[:api]
    bot.access_token.update!(token: preset[:bot]) unless bot.access_token.token == preset[:bot]
    inbox.channel.update!(secret: preset[:secret]) unless inbox.channel.secret == preset[:secret]

    { 'CW_EXPECT_ACCOUNT_ID' => account.id, 'CW_EXPECT_INBOX_ID' => inbox.id }.each do |name, actual|
      expected = ENV[name].to_s
      abort "#{name}=#{expected} difere do id real #{actual}" if !expected.empty? && expected != actual.to_s
    end

    puts "OUT:CHATWOOT_ACCOUNT_ID=#{account.id}"
    puts "OUT:CHATWOOT_INBOX_ID=#{inbox.id}"
  else
    puts 'OUT:CHATWOOT_MODE=live'
    puts "OUT:CHATWOOT_ACCOUNT_ID=#{account.id}"
    puts "OUT:CHATWOOT_INBOX_ID=#{inbox.id}"
    puts "OUT:CHATWOOT_API_TOKEN=#{user.access_token.token}"
    puts "OUT:CHATWOOT_BOT_TOKEN=#{bot.access_token.token}"
    puts "OUT:CHATWOOT_WEBHOOK_SECRET=#{inbox.channel.reload.secret}"
  end
end
puts "COUNTS accounts=#{Account.count} users=#{User.count} account_users=#{AccountUser.count} inboxes=#{Inbox.count} inbox_members=#{InboxMember.count} bots=#{AgentBot.count}"
