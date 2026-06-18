// 県南中央交通圏内にある、対象JR各線の主要駅（地図強調用）。
// キーは /api/train が返す路線ラベルと一致させる。
export interface Station {
  name: string;
  lat: number;
  lng: number;
}

export const LINE_STATIONS: Record<string, Station[]> = {
  "JR京浜東北線": [
    { name: "大宮", lat: 35.9065, lng: 139.6238 },
    { name: "さいたま新都心", lat: 35.8944, lng: 139.631 },
    { name: "与野", lat: 35.8779, lng: 139.639 },
    { name: "北浦和", lat: 35.8741, lng: 139.6486 },
    { name: "浦和", lat: 35.8617, lng: 139.6573 },
    { name: "南浦和", lat: 35.843, lng: 139.668 },
    { name: "蕨", lat: 35.8255, lng: 139.6797 },
    { name: "西川口", lat: 35.8128, lng: 139.703 },
    { name: "川口", lat: 35.8078, lng: 139.724 },
  ],
  "JR埼京・川越線": [
    { name: "大宮", lat: 35.9065, lng: 139.6238 },
    { name: "北与野", lat: 35.8889, lng: 139.623 },
    { name: "与野本町", lat: 35.883, lng: 139.623 },
    { name: "南与野", lat: 35.87, lng: 139.628 },
    { name: "中浦和", lat: 35.855, lng: 139.643 },
    { name: "武蔵浦和", lat: 35.847, lng: 139.645 },
    { name: "戸田公園", lat: 35.809, lng: 139.679 },
    { name: "戸田", lat: 35.817, lng: 139.678 },
    { name: "北戸田", lat: 35.827, lng: 139.672 },
    { name: "日進", lat: 35.926, lng: 139.599 },
    { name: "西大宮", lat: 35.929, lng: 139.579 },
    { name: "指扇", lat: 35.936, lng: 139.564 },
  ],
  "JR宇都宮線": [
    { name: "大宮", lat: 35.9065, lng: 139.6238 },
    { name: "土呂", lat: 35.929, lng: 139.631 },
    { name: "東大宮", lat: 35.956, lng: 139.636 },
    { name: "蓮田", lat: 35.992, lng: 139.662 },
  ],
  "JR高崎線": [
    { name: "大宮", lat: 35.9065, lng: 139.6238 },
    { name: "宮原", lat: 35.943, lng: 139.616 },
    { name: "上尾", lat: 35.9776, lng: 139.5933 },
    { name: "北上尾", lat: 35.993, lng: 139.59 },
    { name: "桶川", lat: 36.0015, lng: 139.5586 },
    { name: "北本", lat: 36.0268, lng: 139.5301 },
    { name: "鴻巣", lat: 36.066, lng: 139.515 },
  ],
  "JR武蔵野線": [
    { name: "西浦和", lat: 35.847, lng: 139.623 },
    { name: "武蔵浦和", lat: 35.847, lng: 139.645 },
    { name: "南浦和", lat: 35.843, lng: 139.668 },
    { name: "東浦和", lat: 35.859, lng: 139.69 },
  ],
};
