admin_email = ENV.fetch('CW_ADMIN_EMAIL', 'admin@revgas.local')
account_name = ENV.fetch('CW_ACCOUNT_NAME', 'RevGás Local')
webhook = ENV.fetch('CW_WEBHOOK_URL', 'http://host.docker.internal:3100/webhooks/chatwoot')
agent_emails = ENV.fetch('CW_AGENT_EMAILS', '').split(',').map { |e| e.strip.downcase }.reject(&:empty?).uniq
agent_password = ENV['CW_AGENT_PASSWORD'].to_s
abort 'CW_AGENT_PASSWORD é obrigatória quando CW_AGENT_EMAILS não está vazia' if agent_emails.any? && agent_password.empty?

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

  puts 'OUT:CHATWOOT_MODE=live'
  puts "OUT:CHATWOOT_ACCOUNT_ID=#{account.id}"
  puts "OUT:CHATWOOT_INBOX_ID=#{inbox.id}"
  puts "OUT:CHATWOOT_API_TOKEN=#{user.access_token.token}"
  puts "OUT:CHATWOOT_BOT_TOKEN=#{bot.access_token.token}"
  puts "OUT:CHATWOOT_WEBHOOK_SECRET=#{inbox.channel.reload.secret}"
end
puts "COUNTS accounts=#{Account.count} users=#{User.count} account_users=#{AccountUser.count} inboxes=#{Inbox.count} inbox_members=#{InboxMember.count} bots=#{AgentBot.count}"
