-- =============================================================
-- KEYWORD SEED — sandeeps.co
-- Run this once in Supabase SQL Editor
-- Topics: Creator economy, online courses, YouTube, Graphy niche
-- =============================================================

INSERT INTO keywords (keyword, search_volume, difficulty, priority) VALUES

-- ── YouTube Monetisation (high volume, matches existing calculator) ──
('how to make money on youtube without 1000 subscribers',  '18,100/mo', 'medium',  10),
('youtube shorts monetization',                            '40,500/mo', 'medium',  10),
('how to monetize youtube channel',                        '27,100/mo', 'medium',   9),
('youtube membership perks ideas',                         '8,100/mo',  'low',      9),
('youtube super thanks',                                   '14,800/mo', 'low',      8),
('youtube channel sponsorship',                            '12,100/mo', 'medium',   8),
('how to get brand deals on youtube',                      '9,900/mo',  'low',      9),
('youtube affiliate marketing',                            '18,100/mo', 'medium',   9),

-- ── Online Course Creation ──
('how to create an online course',                         '40,500/mo', 'high',    10),
('best platform to sell online courses',                   '27,100/mo', 'high',    10),
('how to price an online course',                          '9,900/mo',  'medium',   9),
('online course outline template',                         '8,100/mo',  'low',      9),
('how to validate a course idea',                          '6,600/mo',  'low',      9),
('how to sell courses without a website',                  '5,400/mo',  'low',      8),
('how to make a course on your phone',                     '4,400/mo',  'low',      8),
('passive income online courses',                          '22,200/mo', 'medium',   9),
('how to create a mini course',                            '5,400/mo',  'low',      8),
('cohort based course vs self paced',                      '2,900/mo',  'low',      8),

-- ── Creator Economy ──
('creator economy statistics',                             '9,900/mo',  'low',      9),
('how to become a full time content creator',              '12,100/mo', 'medium',   9),
('how to make money as a content creator',                 '22,200/mo', 'medium',  10),
('content creator tools 2025',                             '8,100/mo',  'low',      8),
('creator burnout',                                        '6,600/mo',  'low',      7),
('content creator income streams',                         '5,400/mo',  'low',      9),
('how to build an audience from scratch',                  '9,900/mo',  'medium',   9),
('personal brand strategy',                                '18,100/mo', 'medium',   8),
('niche down content creator',                             '4,400/mo',  'low',      8),

-- ── Community Building ──
('how to build an online community',                       '14,800/mo', 'medium',   9),
('paid community vs free community',                       '3,600/mo',  'low',      8),
('discord vs slack for community',                         '6,600/mo',  'low',      8),
('how to grow a paid community',                           '4,400/mo',  'low',      9),
('online community engagement ideas',                      '5,400/mo',  'low',      8),
('community led growth',                                   '8,100/mo',  'medium',   8),

-- ── Email & Newsletter Monetisation ──
('how to monetize a newsletter',                           '9,900/mo',  'low',      9),
('paid newsletter examples',                               '5,400/mo',  'low',      8),
('newsletter vs youtube channel',                          '2,400/mo',  'low',      8),
('how to grow email list as creator',                      '6,600/mo',  'low',      9),
('beehiiv vs substack',                                    '8,100/mo',  'low',      8),
('email list monetization strategies',                     '4,400/mo',  'low',      8),

-- ── Coaching & Digital Products ──
('how to sell coaching online',                            '12,100/mo', 'medium',   9),
('digital products to sell online',                        '40,500/mo', 'high',     9),
('how to create a digital product',                        '18,100/mo', 'medium',   9),
('selling ebooks vs courses',                              '3,600/mo',  'low',      8),
('how to price digital products',                          '4,400/mo',  'low',      8),
('best digital products for passive income',               '12,100/mo', 'medium',   9),

-- ── Platform Comparisons (high search intent) ──
('teachable vs thinkific',                                 '18,100/mo', 'medium',   8),
('kajabi alternatives',                                    '9,900/mo',  'medium',   9),
('podia vs kajabi',                                        '6,600/mo',  'low',      8),
('graphy vs teachable',                                    '2,900/mo',  'low',      10),
('best course platform for beginners',                     '12,100/mo', 'medium',   9),
('cheapest way to sell online courses',                    '5,400/mo',  'low',      9)

ON CONFLICT (keyword) DO NOTHING;

-- Verify the insert
SELECT COUNT(*) as total_keywords,
       COUNT(*) FILTER (WHERE used = false) as available
FROM keywords;
