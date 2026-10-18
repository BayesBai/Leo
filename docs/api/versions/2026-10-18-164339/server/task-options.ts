import type { TaskOptions } from '../shared/types.js';
export const taskOptions: TaskOptions = {
  operatorRole: 'salesperson', operatorLabel: '销售员',
  scenarios: [
    { id: 'back_to_school', label: '开学季', audienceSuggestions: ['大学新生', '家长'], focusSuggestions: ['学习任务', '便携需求', '续航需求', '设备协同'] },
    { id: 'office_work', label: '职场办公', audienceSuggestions: ['商务人士', '移动办公者'], focusSuggestions: ['会议与差旅', '文档处理', '多任务协同', '安全需求'] },
    { id: 'content_creation', label: '内容创作', audienceSuggestions: ['设计创作者', '摄影创作者', '视频创作者'], focusSuggestions: ['屏幕需求', '性能需求', '素材流转'] },
    { id: 'family_upgrade', label: '家庭换新', audienceSuggestions: ['家庭用户', '旧机换新者'], focusSuggestions: ['易用性', '家庭共同使用', '数据迁移'] },
    { id: 'business_purchase', label: '企业采购', audienceSuggestions: ['中小企业', '团队采购'], focusSuggestions: ['部署管理', '稳定性', '服务信息'] },
    { id: 'store_visit', label: '门店到访', audienceSuggestions: ['附近潜在顾客'], focusSuggestions: ['核心卖点', '到店体验', '咨询引导'] },
    { id: 'new_product_launch', label: '新品首发', audienceSuggestions: ['关注新品的用户'], focusSuggestions: ['新品变化', '适合人群', '选购建议'] },
    { id: 'holiday_marketing', label: '节日营销', audienceSuggestions: ['送礼人群', '家庭购机人群'], focusSuggestions: ['礼赠', '家庭场景', '选择建议'] },
  ],
  goals: ['到店体验', '私信咨询', '产品种草', '选购参考', '预约演示'], buyingStages: ['初步了解', '对比选择', '购买决策'],
  platforms: [ { id: 'wechat', label: '公众号', minImages: 2, maxImages: 4 },
    { id: 'xiaohongshu', label: '小红书', minImages: 3, maxImages: 6 },
    { id: 'moments', label: '门店朋友圈', minImages: 1, maxImages: 3 }, { id: 'poster', label: '门店海报', minImages: 1, maxImages: 1 } ],
};
