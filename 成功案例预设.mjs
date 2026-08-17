const positions = (title, subject, selling = [13, 72]) => ({
  previewTitle: { left: title[0], top: title[1] },
  previewSub: { left: title[0], top: Math.min(title[1] + 27, 88) },
  previewSelling: { left: selling[0], top: selling[1] },
  previewIp: { left: subject[0], top: subject[1] },
  previewBadge: { left: 76, top: 6 },
  previewBadgeTwo: { left: 6, top: 76 }
});

const casePreset = (number, fileName, name, category, ratio, fields, guidance, previewPositions) => ({
  id: `built_in_case_${String(number).padStart(2, '0')}`,
  sourceVisualId: `case_${String(number).padStart(2, '0')}`,
  sourceFileName: fileName,
  coverStorageName: `case_preset_${String(number).padStart(2, '0')}.png`,
  name,
  category,
  canvasSpec: { ratio },
  visualConfig: {
    presetConfig: {
      presetId: name,
      presetVersion: '2.0.0',
      structureVersion: '网站选项结构化映射 v2',
      presetSource: 'success_case_library',
      caseCategory: category,
      caseGuidance: guidance,
      // This compact blueprint is consumed by Prompt Skill. It keeps each
      // success case reproducible through the same website option vocabulary.
      promptBlueprint: {
        designType: category,
        canvas: ratio,
        palette: `${fields.primaryColor}${fields.secondaryColor ? ` + ${fields.secondaryColor}` : ''}`,
        layout: guidance,
        title: `${fields.titlePosition || 'top_left'} / ${fields.titleLayout || 'two_line_stack'}`,
        subject: fields.subjectPlacement || 'center',
        selling: `${fields.sellingPlacement || 'bottom'} / ${fields.sellingStyle || 'rounded_capsules'}`
      },
      overriddenFields: []
    },
    audienceConfig: {
      schoolStage: 'primary_school',
      gradeBand: fields.gradeBand || 'cross_grade',
      visualPreference: fields.visualPreference,
      marketingIntensity: fields.marketingIntensity || 'medium',
      customVisualIntent: ''
    },
    valueConfig: { valueTier: fields.valueTier || 'balanced_reliable' },
    titleTypographyConfig: {
      titleStyle: fields.titleStyle,
      titleWeight: fields.titleWeight || 'black',
      titleDirection: fields.titleDirection || 'horizontal',
      // The editable baseline stays flat; designers can add an effect later
      // without letting an imported case force a decorative title treatment.
      titleEffect: 'flat'
    },
    bodyTypographyConfig: {
      subtitleStyle: fields.subtitleStyle || 'clean_sans',
      bodyHierarchy: fields.bodyHierarchy || 'headline_plus_detail'
    },
    colorConfig: {
      paletteMode: fields.paletteMode || 'duo_contrast',
      primaryColor: fields.primaryColor,
      secondaryColor: fields.secondaryColor || 'none',
      primaryCustomColor: null,
      secondaryCustomColor: null,
      saturation: fields.saturation || 'high'
    },
    finishConfig: { surfaceTexture: fields.surfaceTexture || 'flat_clean' },
    illustrationConfig: {
      illustrationMode: fields.illustrationMode || 'hero_illustration',
      subjectType: fields.subjectType || 'learning_tools',
      illustrationStyle: fields.illustrationStyle || 'graphic_poster',
      assetType: fields.assetType || 'standard',
      ipReferenceUploaded: false,
      ipScale: fields.ipScale || 140
    },
    decorationConfig: { coverElement: fields.coverElement || 'none' },
    layoutComponentConfig: {
      compositionTemplate: fields.compositionTemplate,
      titlePosition: fields.titlePosition,
      subjectPlacement: fields.subjectPlacement,
      backgroundStructure: fields.backgroundStructure,
      backgroundPosition: String(fields.backgroundPosition || 60),
      titleLayout: fields.titleLayout || 'two_line_stack',
      titleColorTreatment: fields.titleColorTreatment || 'primary_secondary',
      titleContainer: 'none',
      personPlacement: fields.personPlacement || 'center_group',
      sellingPlacement: fields.sellingPlacement || 'bottom',
      sellingStyle: fields.sellingStyle || 'rounded_capsules',
      sellingArrangement: fields.sellingArrangement || 'columns'
    },
    canvasAllocation: {
      headlinePercent: fields.headlinePercent,
      illustrationPercent: fields.illustrationPercent,
      informationPercent: fields.informationPercent,
      negativeSpacePercent: fields.negativeSpacePercent
    },
    textRenderConfig: { previewPositions }
  },
  previewPositions
});

export const successCasePresets = [
  casePreset(1, '礼盒封面-1.png', '蓝黄名师课程', '专业名师 · 左文右人', '4:3', { visualPreference: 'professional_reliable', valueTier: 'authoritative_premium', titleStyle: 'inflated_3d', titleEffect: 'extruded', primaryColor: 'blue', secondaryColor: 'yellow', illustrationStyle: 'graphic_poster', compositionTemplate: 'left_text_right_person', titlePosition: 'top_left', subjectPlacement: 'right', personPlacement: 'right_half', backgroundStructure: 'subtle_pattern_full_bleed', sellingPlacement: 'bottom_arc', sellingStyle: 'laurel_medallions', headlinePercent: 45, illustrationPercent: 30, informationPercent: 20, negativeSpacePercent: 5 }, '蓝黄高对比横版，左侧两至三行大标题，右侧为上传的授权讲师或学习人物，底部黄色弧带承托三枚等距权威卖点圆章；背景只保留低对比菱形暗纹与轻量学习元素。', positions([12, 13], [60, 22], [12, 73])),
  casePreset(2, '礼盒封面-2.png', '红金国风上文下景', '权威国风 · 上文下景', '4:3', { visualPreference: 'professional_reliable', valueTier: 'authoritative_premium', titleStyle: 'scholarly_culture', primaryColor: 'red', secondaryColor: 'yellow', surfaceTexture: 'paper_grain', illustrationStyle: 'chinese_ink_wash', subjectType: 'nature_exploration', compositionTemplate: 'top_text_bottom_scene', titlePosition: 'top_left', subjectPlacement: 'bottom_full', backgroundStructure: 'top_bottom_blocks', sellingPlacement: 'under_title', sellingStyle: 'short_phrase_row', headlinePercent: 48, illustrationPercent: 42, informationPercent: 5, negativeSpacePercent: 5 }, '朱红上半区保留大留白，金色庄重标题与一行短规则副标题左上对齐，中部细金线分界；下半区为水墨青蓝山水、书卷和飞鸟的泛国风学习场景，不复制原场景、章或文字。', positions([11, 14], [25, 50], [12, 39])),
  casePreset(3, '礼盒封面-3.png', '亮蓝金冲刺', '考试冲刺 · 极简文字', '3:4', { visualPreference: 'professional_reliable', valueTier: 'authoritative_premium', titleStyle: 'geometric_modern', titleEffect: 'outline', primaryColor: 'blue', secondaryColor: 'yellow', saturation: 'high', surfaceTexture: 'paper_grain', illustrationMode: 'accent_elements', subjectType: 'abstract_graphics', compositionTemplate: 'center_info_board', titlePosition: 'middle_center', subjectPlacement: 'center', backgroundStructure: 'subtle_pattern_full_bleed', titleLayout: 'two_line_stack', sellingPlacement: 'under_title', sellingStyle: 'short_phrase_row', headlinePercent: 55, illustrationPercent: 15, informationPercent: 15, negativeSpacePercent: 15 }, '亮学院蓝竖版，低对比同心涡纹从中心扩散，居中放置明黄超大标题；只保留一枚轻量标签和一句冲刺承诺，不出现人物、播放图标或密集卖点。', positions([50, 41], [50, 58], [18, 61])),
  casePreset(4, '礼盒封面-4.png', '赤红名师数据', '名师转化 · 数据底栏', '4:3', { visualPreference: 'growth_motivation', valueTier: 'authoritative_premium', titleStyle: 'geometric_modern', primaryColor: 'red', secondaryColor: 'yellow', illustrationStyle: 'graphic_poster', assetType: 'teacher_photo', compositionTemplate: 'left_person_right_text', titlePosition: 'top_right', subjectPlacement: 'left', personPlacement: 'left_half', backgroundStructure: 'motion_swoosh', sellingPlacement: 'bottom_data_bar', sellingStyle: 'equal_data_cards', headlinePercent: 40, illustrationPercent: 35, informationPercent: 20, negativeSpacePercent: 5 }, '赤红横版，左侧仅使用新上传的授权讲师，右侧放白黄两层超大标题；背景以细线圆弧和坐标感图形强化理性；底部米黄条固定分为四至五个等宽的量化卖点单元。', positions([88, 16], [6, 28], [8, 74])),
  casePreset(5, '礼盒封面-5.png', '红金数学探索', '权威学科 · 上文下画', '4:3', { visualPreference: 'exploration_thinking', valueTier: 'authoritative_premium', titleStyle: 'scholarly_culture', primaryColor: 'red', secondaryColor: 'yellow', surfaceTexture: 'paper_grain', illustrationStyle: 'graphic_poster', subjectType: 'subject_symbols', compositionTemplate: 'top_text_bottom_scene', titlePosition: 'top_left', subjectPlacement: 'bottom_full', backgroundStructure: 'top_bottom_blocks', sellingPlacement: 'under_title', sellingStyle: 'short_phrase_row', headlinePercent: 45, illustrationPercent: 45, informationPercent: 5, negativeSpacePercent: 5 }, '红色上半区为金色权威大标题和一行规则标签，下半区为蓝黄数学探索插画；使用泛化公式、纸飞机、几何与运动曲线，不复制原钟表、人物或题目。', positions([11, 14], [24, 51], [12, 39])),
  casePreset(6, '礼盒封面-6.png', '黄紫拼读方阵', '童趣拼读 · 四栏数据', '4:3', { visualPreference: 'playful_lively', valueTier: 'affordable_abundant', titleStyle: 'inflated_3d', titleEffect: 'outline', primaryColor: 'yellow', secondaryColor: 'purple', illustrationStyle: 'three_d_toy_render', compositionTemplate: 'top_text_bottom_scene', titlePosition: 'top_left', subjectPlacement: 'right', backgroundStructure: 'curved_split', sellingPlacement: 'bottom_data_bar', sellingStyle: 'icon_number_pills', headlinePercent: 40, illustrationPercent: 35, informationPercent: 20, negativeSpacePercent: 5 }, '明黄和深紫大色块，左上为圆角大标题牌，右侧为原创 3D 学习萌物或书本主体；底部深紫横条固定四等分，使用数字胶囊加两行说明，不复制案例角色。', positions([10, 13], [61, 25], [8, 75])),
  casePreset(7, '礼盒封面-7.png', '红金英语探索', '权威英语 · 国际场景', '4:3', { visualPreference: 'exploration_thinking', valueTier: 'authoritative_premium', titleStyle: 'scholarly_culture', primaryColor: 'red', secondaryColor: 'yellow', surfaceTexture: 'paper_grain', illustrationStyle: 'graphic_poster', subjectType: 'nature_exploration', compositionTemplate: 'top_text_bottom_scene', titlePosition: 'top_left', subjectPlacement: 'bottom_full', backgroundStructure: 'top_bottom_blocks', sellingPlacement: 'under_title', sellingStyle: 'short_phrase_row', headlinePercent: 45, illustrationPercent: 45, informationPercent: 5, negativeSpacePercent: 5 }, '上红下蓝，金色标题区保持庄重；下半区以字母、抽象地标、学习人物和运动弧线构成国际学习旅程，不出现真实城市、原地标或原认证标识。', positions([11, 14], [25, 51], [12, 39])),
  casePreset(8, '礼盒封面-8.png', '赤红高端参数课', '高端课程 · 极简数据', '4:3', { visualPreference: 'professional_reliable', valueTier: 'authoritative_premium', titleStyle: 'geometric_modern', primaryColor: 'red', secondaryColor: 'white_gold', illustrationMode: 'accent_elements', subjectType: 'abstract_graphics', compositionTemplate: 'top_text_bottom_data', titlePosition: 'top_left', subjectPlacement: 'none', backgroundStructure: 'motion_swoosh', sellingPlacement: 'bottom_data_bar', sellingStyle: 'laurel_stat_row', headlinePercent: 50, illustrationPercent: 15, informationPercent: 25, negativeSpacePercent: 10 }, '赤红大留白横版，左上放细长金色参数式标题，右侧只保留半透明圆角曲线与同色细线；底部白色横带为四至五项量化卖点，整体不使用人物。', positions([10, 14], [72, 36], [7, 75])),
  casePreset(9, '礼盒封面-9.png', '红点数学萌趣', '数学萌趣 · 网格数据', '4:3', { visualPreference: 'playful_lively', valueTier: 'affordable_abundant', titleStyle: 'rounded_playful', titleEffect: 'outline', primaryColor: 'red', secondaryColor: 'yellow', illustrationStyle: 'picture_book', subjectType: 'subject_symbols', compositionTemplate: 'left_text_right_ip', titlePosition: 'top_left', subjectPlacement: 'right', backgroundStructure: 'subtle_pattern_full_bleed', sellingPlacement: 'bottom_data_bar', sellingStyle: 'grid_paper_metric_cards', headlinePercent: 40, illustrationPercent: 28, informationPercent: 25, negativeSpacePercent: 7 }, '红色圆点底纹，左上黄白圆润两层标题，右侧为原创数字或学科萌物；中部可放三条方法短句，底部浅色网格区放四项大数字卖点。', positions([10, 13], [61, 24], [7, 72])),
  casePreset(10, '礼盒封面-10.png', '红白语文四模块', '语文模块 · 场景窗口', '4:3', { visualPreference: 'professional_reliable', titleStyle: 'scholarly_culture', primaryColor: 'red', secondaryColor: 'orange', surfaceTexture: 'paper_grain', illustrationStyle: 'picture_book', subjectType: 'learning_tools', compositionTemplate: 'top_text_bottom_scene', titlePosition: 'top_left', subjectPlacement: 'bottom_full', backgroundStructure: 'top_bottom_blocks', sellingPlacement: 'bottom', sellingStyle: 'window_modules', sellingArrangement: 'grid', headlinePercent: 35, illustrationPercent: 42, informationPercent: 18, negativeSpacePercent: 5 }, '上白下红，顶部文化感橙色大标题，左侧可加一个短竖标签；中下区固定四个等宽圆角学习场景窗口承载卖点，不再叠加数字型底栏。', positions([12, 10], [10, 43], [8, 60])),
  casePreset(11, '礼盒封面-11.png', '橙黄冲刺萌物', '专项突破 · 左文右萌物', '4:3', { visualPreference: 'playful_lively', valueTier: 'affordable_abundant', titleStyle: 'condensed_speed', titleDirection: 'diagonal', titleEffect: 'hard_shadow', primaryColor: 'orange', secondaryColor: 'yellow', illustrationStyle: 'three_d_toy_render', compositionTemplate: 'left_text_right_ip', titlePosition: 'top_left', subjectPlacement: 'right', backgroundStructure: 'curved_split', sellingPlacement: 'bottom_data_bar', sellingStyle: 'icon_number_pills', headlinePercent: 40, illustrationPercent: 35, informationPercent: 20, negativeSpacePercent: 5 }, '橙黄高饱和横版，左上为白黄斜切冲刺标题，右侧为原创学习萌物和学科道具；底部黄色信息带放年级短标签及四项蓝白数字胶囊。', positions([10, 12], [62, 23], [7, 75])),
  casePreset(12, '礼盒封面-12.png', '黄紫中心信息牌', '童趣数据 · 居中信息板', '3:4', { visualPreference: 'playful_lively', valueTier: 'affordable_abundant', titleStyle: 'rounded_playful', titleEffect: 'outline', primaryColor: 'yellow', secondaryColor: 'purple', illustrationMode: 'accent_elements', subjectType: 'abstract_graphics', compositionTemplate: 'center_info_board', titlePosition: 'top_center', subjectPlacement: 'center', backgroundStructure: 'inset_info_panel', sellingPlacement: 'bottom', sellingStyle: 'centered_number_cluster', sellingArrangement: 'grid', headlinePercent: 50, illustrationPercent: 10, informationPercent: 28, negativeSpacePercent: 12 }, '紫色条纹竖版底，中间为占画面主体的巨大黄色圆角信息牌；标题与五项数字卖点居中对齐，周边只放少量泛化涂鸦学科元素。', positions([50, 18], [50, 43], [14, 62])),
  casePreset(13, '礼盒封面-13.png', '红白考纲竖版', '权威考纲 · 纵向标题', '3:4', { visualPreference: 'professional_reliable', valueTier: 'authoritative_premium', titleStyle: 'geometric_modern', titleDirection: 'vertical', primaryColor: 'red', secondaryColor: 'white_gold', illustrationMode: 'accent_elements', subjectType: 'subject_symbols', compositionTemplate: 'split_columns', titlePosition: 'top_left', subjectPlacement: 'left', backgroundStructure: 'left_right_blocks', titleLayout: 'vertical_stack', sellingPlacement: 'bottom', sellingStyle: 'short_phrase_row', headlinePercent: 65, illustrationPercent: 8, informationPercent: 15, negativeSpacePercent: 12 }, '红白严格左右分栏竖版，左红区使用纵向或多行白色超大标题，旁边为金色细竖说明；右白区留出徽章和年级位，底部仅两条勾选式承诺与细建筑线稿。', positions([14, 16], [72, 55], [10, 77])),
  casePreset(14, '礼盒封面-14.png', '紫橙自然拼读', '自然拼读 · 图标数据', '3:4', { visualPreference: 'playful_lively', valueTier: 'affordable_abundant', titleStyle: 'inflated_3d', titleDirection: 'diagonal', titleEffect: 'outline', primaryColor: 'purple', secondaryColor: 'orange', illustrationStyle: 'three_d_toy_render', compositionTemplate: 'top_text_bottom_scene', titlePosition: 'top_left', subjectPlacement: 'center', backgroundStructure: 'curved_split', sellingPlacement: 'bottom', sellingStyle: 'icon_number_cards', sellingArrangement: 'grid', headlinePercent: 42, illustrationPercent: 35, informationPercent: 18, negativeSpacePercent: 5 }, '紫色上区和橙色大弧形下区，白橙描边的倾斜拼读标题跨越两区；原创萌物配发音道具，底部四个图标化数字卖点，保留节奏但不复制英文或角色。', positions([11, 15], [30, 39], [8, 76])),
  casePreset(15, '礼盒封面-15.png', '橙黄学科萌物', '学科冲刺 · 三栏数据', '4:3', { visualPreference: 'playful_lively', valueTier: 'affordable_abundant', titleStyle: 'condensed_speed', titleDirection: 'diagonal', titleEffect: 'hard_shadow', primaryColor: 'orange', secondaryColor: 'yellow', illustrationStyle: 'three_d_toy_render', compositionTemplate: 'left_text_right_ip', titlePosition: 'top_left', subjectPlacement: 'right', backgroundStructure: 'curved_split', sellingPlacement: 'bottom_data_bar', sellingStyle: 'icon_number_pills', headlinePercent: 42, illustrationPercent: 33, informationPercent: 20, negativeSpacePercent: 5 }, '左侧白黄斜切标题，右侧原创学习萌物与书本、字母、算式等道具；底部黄带加入年级短标签和三至四组蓝色数字信息块，画面比案例 11 更强调学科道具。', positions([10, 12], [62, 22], [7, 75])),
  casePreset(16, '礼盒封面-16.png', '赤红寒假通关', '节日学习 · 3D 中心主体', '3:4', { visualPreference: 'growth_motivation', titleStyle: 'block_building', titleEffect: 'outline', primaryColor: 'red', secondaryColor: 'yellow', illustrationStyle: 'three_d_toy_render', compositionTemplate: 'top_text_bottom_scene', titlePosition: 'top_center', subjectPlacement: 'center', backgroundStructure: 'solid_full_bleed', sellingPlacement: 'bottom', sellingStyle: 'rounded_capsules', sellingArrangement: 'grid', headlinePercent: 42, illustrationPercent: 40, informationPercent: 13, negativeSpacePercent: 5 }, '赤红竖版，顶部白黄两层大标题与小年级标签，中部原创 3D 吉祥物站在学习道具台座上，周边使用日历、书本、画笔等泛节日学习元素，底部两至三条圆角卖点标签。', positions([50, 12], [28, 38], [9, 78])),
  casePreset(17, '礼盒封面-17.png', '红金视频课程', '视频课程 · 胶片动线', '4:3', { visualPreference: 'growth_motivation', titleStyle: 'condensed_speed', titleDirection: 'diagonal', titleEffect: 'hard_shadow', primaryColor: 'red', secondaryColor: 'yellow', illustrationStyle: 'graphic_poster', subjectType: 'learning_tools', compositionTemplate: 'top_text_bottom_data', titlePosition: 'top_left', subjectPlacement: 'center', backgroundStructure: 'motion_swoosh', coverElement: 'film_playback', sellingPlacement: 'bottom_data_bar', sellingStyle: 'laurel_medallions', headlinePercent: 45, illustrationPercent: 30, informationPercent: 20, negativeSpacePercent: 5 }, '红金动势横版，以浅米色胶片带和抽象播放图形形成对角线；标题使用红白速度字，配泛化视频学习工具插图；底部四项量化卖点等距排列。', positions([11, 13], [38, 35], [8, 75])),
  casePreset(18, '礼盒封面-18.png', '蓝金词汇徽章', '品质体系 · 舞台数据', '3:4', { visualPreference: 'professional_reliable', valueTier: 'quality_systematic', titleStyle: 'block_building', titleEffect: 'outline', primaryColor: 'blue', secondaryColor: 'yellow', illustrationStyle: 'picture_book', subjectType: 'learning_tools', compositionTemplate: 'center_info_board', titlePosition: 'middle_center', subjectPlacement: 'center', backgroundStructure: 'stage_curtain', sellingPlacement: 'bottom', sellingStyle: 'laurel_stat_row', sellingArrangement: 'grid', headlinePercent: 45, illustrationPercent: 30, informationPercent: 20, negativeSpacePercent: 5 }, '深蓝舞台竖版，中间用浅金信息柱建立层级，上部可放四个小型学习主题窗口，中部深蓝徽章式标题牌，底部为五项白色大数字与小说明。', positions([50, 42], [25, 18], [8, 71])),
  casePreset(19, '小学英语名师速通课-礼盒-正面.png', '红黄英语速通', '英语礼盒 · 群像三栏', '3:4', { visualPreference: 'growth_motivation', titleStyle: 'block_building', titleEffect: 'hard_shadow', primaryColor: 'red', secondaryColor: 'yellow', surfaceTexture: 'paper_grain', illustrationStyle: 'picture_book', subjectType: 'learning_tools', compositionTemplate: 'top_text_bottom_scene', titlePosition: 'top_center', subjectPlacement: 'center', backgroundStructure: 'curved_split', sellingPlacement: 'bottom', sellingStyle: 'three_column_ribbon', headlinePercent: 42, illustrationPercent: 38, informationPercent: 15, negativeSpacePercent: 5 }, '红黄英语礼盒竖版，顶部可用泛化学科弧形标签，中上部白黄超大标题，下半部为原创学习人物群像和字母道具，后方白色圆弧框；底部用黄色承诺短条和红色三栏卖点收口。', positions([50, 11], [22, 42], [7, 80]))
];
