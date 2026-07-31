const SHA256 = /^[a-f0-9]{64}$/;

function hasSha256(value) {
  return typeof value === 'string' && SHA256.test(value);
}

export function fashionVideoCapability({
  lookId,
  approvedLook = null,
  motionReference = null,
} = {}) {
  const approvedLookReady = typeof lookId === 'string'
    && lookId.length > 0
    && approvedLook?.look_id === lookId
    && hasSha256(approvedLook.image_sha256)
    && hasSha256(approvedLook.receipt_sha256);
  const referencePathReady = typeof motionReference?.reference_path === 'string'
    && motionReference.reference_path.length > 0;
  const styleReferenceReady = motionReference?.state === 'READY'
    && referencePathReady
    && hasSha256(motionReference.reference_pack_sha256);
  const motionReferenceReady = motionReference?.state === 'READY'
    && referencePathReady
    && hasSha256(motionReference.reference_sha256);
  const verifiedStyles = (motionReference?.available_styles ?? []).filter(
    (style) => typeof style?.id === 'string'
      && typeof style?.title === 'string'
      && typeof style?.motion_mode === 'string'
      && hasSha256(style?.preview_sha256),
  );
  const styleCatalogReady = verifiedStyles.length === 3;
  const available = approvedLookReady
    && styleReferenceReady
    && motionReferenceReady
    && styleCatalogReady;
  const styles = available
    ? verifiedStyles.map((style) => Object.freeze({
        id: style.id,
        title: style.title,
        motion_mode: style.motion_mode,
        preview_url: `/api/profile/looks/${encodeURIComponent(lookId)}/video-styles/${encodeURIComponent(style.id)}/preview`,
        // A contact sheet is only the poster.  The style itself is a real
        // reference video and must be visible before a paid create is allowed.
        reference_url: `/api/profile/looks/${encodeURIComponent(lookId)}/video-styles/${encodeURIComponent(style.id)}/reference`,
      }))
    : [];

  return Object.freeze({
    capability: 'fashion_video',
    look_id: lookId,
    available,
    styles: Object.freeze(styles),
    create_route: '/api/profile/video-clips',
    requirements: Object.freeze({
      approved_master_look: approvedLookReady,
      verified_style_reference: styleReferenceReady,
      verified_motion_reference: motionReferenceReady,
      three_video_styles: styleCatalogReady,
    }),
    reason_code: available
      ? 'FASHION_VIDEO_READY'
      : 'FASHION_VIDEO_REFERENCE_PACK_REQUIRED',
    next_action: available ? 'CREATE_FASHION_VIDEO' : 'SELECT_VERIFIED_VIDEO_STYLE',
  });
}
