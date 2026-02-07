-- Create push_subscriptions table for Web Push Notifications
-- This table stores browser push notification subscriptions for users

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  -- Ensure one subscription per endpoint (browser can have multiple tabs/devices)
  constraint push_subscriptions_unique_endpoint unique (endpoint)
);

-- Index for querying subscriptions by user
create index if not exists push_subscriptions_user_id on public.push_subscriptions(user_id);

-- Enable RLS
alter table public.push_subscriptions enable row level security;

-- RLS Policies
-- Users can only see their own subscriptions
create policy "Users can view their own push subscriptions"
  on public.push_subscriptions
  for select
  using (auth.uid() = user_id);

-- Users can insert their own subscriptions
create policy "Users can insert their own push subscriptions"
  on public.push_subscriptions
  for insert
  with check (auth.uid() = user_id);

-- Users can update their own subscriptions
create policy "Users can update their own push subscriptions"
  on public.push_subscriptions
  for update
  using (auth.uid() = user_id);

-- Users can delete their own subscriptions
create policy "Users can delete their own push subscriptions"
  on public.push_subscriptions
  for delete
  using (auth.uid() = user_id);
