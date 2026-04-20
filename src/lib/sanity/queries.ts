export const newsPostsQuery = `
  *[_type == "newsPost"] | order(coalesce(publishedAt, _createdAt) desc) {
    title,
    "slug": slug.current,
    excerpt,
    publishedAt,
    "coverImage": coverImage.asset->url,
    body,
    tags,
    featured
  }
`;

export const newsPostBySlugQuery = `
  *[_type == "newsPost" && slug.current == $slug][0] {
    title,
    "slug": slug.current,
    excerpt,
    publishedAt,
    "coverImage": coverImage.asset->url,
    body,
    tags,
    featured
  }
`;

export const siteSettingsQuery = `
  *[_type == "siteSettings"][0]{
    siteTitle,
    siteDescription,
    discordUrl,
    twitchUrl,
    youtubeUrl,
    downloadUrl,
    guideVideoId
  }
`;

export const homeHeroQuery = `
  *[_type == "homeHero"][0]{
    eyebrow,
    headline,
    subheading,
    primaryCtaLabel,
    primaryCtaHref,
    secondaryCtaLabel,
    secondaryCtaHref
  }
`;

export const adSlotsQuery = `
  *[_type == "adSlot"]{
    placement,
    mode,
    title,
    eyebrow,
    body,
    ctaLabel,
    ctaHref,
    imageUrl,
    adsenseClient,
    adsenseSlot
  }
`;

export const streamModuleQuery = `
  *[_type == "streamModule"][0]{
    title,
    subtitle,
    channelLogin,
    channelUrl
  }
`;
