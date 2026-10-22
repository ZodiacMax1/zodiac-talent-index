const API = 'https://api.monday.com/v2';

export async function gql(query, variables) {
  const token = process.env.MONDAY_TOKEN;
  if (!token) throw new Error('MONDAY_TOKEN is not set');
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: token },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(20000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.errors) {
    throw new Error('monday API error: ' + JSON.stringify(json.errors || json.error_message || res.status).slice(0, 400));
  }
  return json.data;
}

const ITEM = `id name group { id title } column_values(ids: $cols) {
  id type text value
  ... on MirrorValue { display_value }
  ... on BoardRelationValue { linked_item_ids }
}`;

// Fetch every item on a board (only the listed columns), following the cursor.
export async function fetchItems(boardId, columnIds, queryParams = null, pageSize = 200) {
  const items = [];
  let data = await gql(
    `query($id:[ID!], $cols:[String!], $limit:Int, $qp:ItemsQuery){
       boards(ids:$id){ items_page(limit:$limit, query_params:$qp){ cursor items{ ${ITEM} } } } }`,
    { id: [boardId], cols: columnIds, limit: pageSize, qp: queryParams }
  );
  let page = data.boards[0]?.items_page;
  if (!page) throw new Error('Board ' + boardId + ' not found or no access');
  items.push(...page.items);
  let guard = 0;
  while (page.cursor && guard++ < 100) {
    data = await gql(
      `query($cols:[String!], $limit:Int, $cursor:String!){
         next_items_page(limit:$limit, cursor:$cursor){ cursor items{ ${ITEM} } } }`,
      { cols: columnIds, limit: pageSize, cursor: page.cursor }
    );
    page = data.next_items_page;
    items.push(...page.items);
  }
  return items;
}

export function cv(item, id) {
  return item.column_values.find((c) => c.id === id);
}
