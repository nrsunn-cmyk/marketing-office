import { expect, test } from '@playwright/test';
import { loginWithWorkspace, adminClient } from './helpers';
test('CR06: valid currency-suffixed zero must expose the free-item confirmation',async({page})=>{
 await loginWithWorkspace(page);
 const admin=adminClient();
 const {data:task,error:ce}=await admin.from('tasks').select('id').eq('type','quote').order('created_at').limit(1).single();
 if(ce)throw ce;
 await page.goto('/tasks/'+task.id);
 const editor=page.getByRole('form',{name:'견적 작성'});
 await editor.getByLabel('1번째 줄 항목명',{exact:true}).fill('무료 상담');
 await editor.getByLabel('1번째 줄 단가',{exact:true}).fill('0원');
 await expect(editor.getByText('단가 0원은 무료 항목인지 확인이 필요합니다.',{exact:true})).toBeVisible();
 await expect(editor.getByLabel('무료 항목이 맞습니다')).toBeVisible();
});

test("CR06: 0, 0원, 0 원 모두 무료 확인란이 나오고 잘못된 값은 나오지 않는다", async ({ page }) => {
  await loginWithWorkspace(page);
  const admin = adminClient();
  const { data: task, error } = await admin.from("tasks").select("id").eq("type", "quote").order("created_at").limit(1).single();
  if (error) throw error;
  await page.goto("/tasks/" + task.id);
  const editor = page.getByRole("form", { name: "견적 작성" });
  const price = editor.getByLabel("1번째 줄 단가", { exact: true });
  for (const v of ["0", "0원", "0 원"]) {
    await price.fill(v);
    await expect(editor.getByLabel("무료 항목이 맞습니다"), v).toBeVisible();
  }
  await price.fill("영원");
  await expect(editor.getByLabel("무료 항목이 맞습니다")).toHaveCount(0);
  await price.fill("0원");
  await editor.getByLabel("무료 항목이 맞습니다").check();
  await expect(editor.getByText("단가 0원은 무료 항목인지 확인이 필요합니다.", { exact: true })).toHaveCount(0);
});
