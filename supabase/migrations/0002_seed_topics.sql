-- Launch taxonomy: tech, science, engineering, and long-form learning.
-- Deliberately small (plan: 30 to 50 topics). Two levels only.

insert into topics (slug, name) values
  ('technology',   'Technology'),
  ('science',      'Science'),
  ('mathematics',  'Mathematics'),
  ('engineering',  'Engineering'),
  ('design',       'Design'),
  ('learning',     'Learning & Ideas');

insert into topics (slug, name, parent_topic_id)
select v.slug, v.name, p.id
from (values
  ('ai',                  'AI',                       'technology'),
  ('llms',                'LLMs',                     'technology'),
  ('computer-vision',     'Computer Vision',          'technology'),
  ('programming',         'Programming',              'technology'),
  ('rust',                'Rust',                     'technology'),
  ('python',              'Python',                   'technology'),
  ('systems',             'Systems',                  'technology'),
  ('distributed-systems', 'Distributed Systems',      'technology'),
  ('databases',           'Databases',                'technology'),
  ('security',            'Security',                 'technology'),
  ('web',                 'Web Development',          'technology'),
  ('hardware',            'Hardware',                 'technology'),
  ('gpu',                 'GPU',                      'technology'),
  ('cpu',                 'CPU',                      'technology'),
  ('computer-science',    'Computer Science',         'technology'),
  ('physics',             'Physics',                  'science'),
  ('biology',             'Biology',                  'science'),
  ('chemistry',           'Chemistry',                'science'),
  ('space',               'Space',                    'science'),
  ('climate',             'Climate & Energy',         'science'),
  ('neuroscience',        'Neuroscience',             'science'),
  ('statistics',          'Statistics',               'mathematics'),
  ('pure-math',           'Pure Math',                'mathematics'),
  ('civil-engineering',   'Civil Engineering',        'engineering'),
  ('electronics',         'Electronics',              'engineering'),
  ('manufacturing',       'Manufacturing',            'engineering'),
  ('aerospace',           'Aerospace',                'engineering'),
  ('ui-design',           'Interface Design',         'design'),
  ('typography',          'Typography',               'design'),
  ('architecture',        'Architecture',             'design'),
  ('history',             'History',                  'learning'),
  ('economics',           'Economics',                'learning'),
  ('philosophy',          'Philosophy',               'learning'),
  ('video-essays',        'Video Essays',             'learning'),
  ('documentaries',       'Documentaries',            'learning'),
  ('conference-talks',    'Conference Talks',         'learning')
) as v(slug, name, parent)
join topics p on p.slug = v.parent;
