export function mentorMatches(profile, people) {
  if (profile?.role !== 'Mentee' || !profile.intake?.story) return [];
  const topics = {
    'Software development': /\b(coding|programming|software|web development|frontend|backend|javascript|python|app development)\b/i,
    'Data and analytics': /\b(analytics|data science|data analysis|sql|statistics|business intelligence)\b/i,
    'AI and machine learning': /\b(ai|artificial intelligence|machine learning|generative ai|llms?)\b/i,
    Cybersecurity: /\b(cybersecurity|information security|network security|security engineering)\b/i,
    'User experience': /\b(ux|user experience|user research|usability|product design|figma)\b/i,
    'Product management': /\b(product management|product manager|product strategy|product owner)\b/i,
    'Cloud and infrastructure': /\b(cloud|devops|aws|azure|kubernetes|infrastructure)\b/i,
    Healthcare: /\b(healthcare|health care|medicine|nursing|health tech|clinical)\b/i,
    Education: /\b(education|teaching|edtech|teacher)\b/i,
    Entrepreneurship: /\b(entrepreneurship|startups?|small business|founder)\b/i,
    Accessibility: /\b(accessibility|assistive technology|inclusive design)\b/i,
    Psychology: /\b(psychology|behavioral science|cognitive science)\b/i,
    'Creative media': /\b(drawing|illustration|photography|animation|graphic design|video editing)\b/i,
    'Games': /\b(game development|game design|video games|unity|unreal engine)\b/i,
    'Climate and sustainability': /\b(climate|sustainability|renewable energy|environmental science)\b/i,
    'Finance and business': /\b(finance|accounting|fintech|economics|business administration)\b/i,
    Robotics: /\b(robotics|electronics|embedded systems|arduino)\b/i,
  };
  const stop = new Set('about after already and because been before being could currently experience first from goals have help into interested interests learn learning like mentor mentoring myself online other people person really should some story tech technology their them then they things this through want wanted when where which while with work working would years also career group groups one on meet looking background share help build building enjoy'.split(' '));
  const terms = text => new Set((text.toLowerCase().match(/[a-z][a-z0-9]{3,}/g) || []).filter(word => !stop.has(word)));
  const textOf = p => [p.focus,p.intake?.story].filter(Boolean).join(' ');
  const story = textOf(profile);
  const ownTerms = terms(story);
  return people.filter(p => p.id !== profile.id && p.username && p.role === 'Mentor').map(p => {
    const text = textOf(p);
    const shared = Object.entries(topics).filter(([,pattern]) => pattern.test(story) && pattern.test(text)).map(([name]) => name);
    const exact = [...terms(p.focus || '')].filter(term => ownTerms.has(term));
    const common = shared.length ? shared : exact.length >= 2 ? exact.slice(0,4) : [];
    const preferences = [];
    if (profile.intake.style === p.intake?.style) preferences.push(profile.intake.style);
    if (profile.intake.format === p.intake?.format) preferences.push(profile.intake.format);
    return {id:p.id,common,preferences,score:shared.length * 8 + Math.min(exact.length,4) + preferences.length};
  }).filter(match => match.common.length).sort((a,b) => b.score-a.score).slice(0,6);
}
