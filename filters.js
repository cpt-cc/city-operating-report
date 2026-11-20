'use strict';

function createFilterPicker(input, label, allLabel, onSelect) {
  const list = document.createElement('div');
  list.id = input.id + '-options';
  list.className = 'filter-options';
  list.setAttribute('role','listbox');
  list.setAttribute('aria-label',label);
  list.hidden = true;
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'filter-toggle';
  toggle.tabIndex = -1;
  toggle.setAttribute('aria-label','展开' + label + '选项');
  input.placeholder = allLabel;
  input.setAttribute('aria-controls',list.id);
  input.after(toggle,list);

  let options = [];
  let matches = [];
  let selected = '';
  let active = -1;
  const searchText = text => text.normalize('NFKC').toLowerCase().replace(/\s+/g,'');

  function hide() {
    list.hidden = true;
    input.setAttribute('aria-expanded','false');
    input.removeAttribute('aria-activedescendant');
    input.value = selected;
    active = -1;
  }
  function show(query) {
    const needle = searchText(query);
    matches = options.filter(option => searchText(option.label).includes(needle));
    active = -1;
    input.removeAttribute('aria-activedescendant');
    const items = matches.map((option,index) => {
      const item = document.createElement('div');
      item.id = list.id + '-' + index;
      item.className = 'filter-option';
      item.dataset.option = String(index);
      item.setAttribute('role','option');
      item.setAttribute('aria-selected',String(option.value === selected));
      item.textContent = option.label;
      return item;
    });
    if (!items.length) {
      const message = document.createElement('div');
      message.className = 'filter-no-results';
      message.setAttribute('role','status');
      message.textContent = '无匹配结果';
      items.push(message);
    }
    list.replaceChildren(...items);
    list.hidden = false;
    input.setAttribute('aria-expanded','true');
  }
  function activate(index) {
    if (!matches.length) return;
    list.children[active]?.classList.remove('active');
    active = (index + matches.length) % matches.length;
    const item = list.children[active];
    item.classList.add('active');
    input.setAttribute('aria-activedescendant',item.id);
    item.scrollIntoView({block:'nearest'});
  }
  function commit(index) {
    const option = matches[index];
    if (!option) return;
    const changed = selected !== option.value;
    selected = option.value;
    hide();
    if (changed) onSelect(selected);
  }

  input.addEventListener('focus', () => { show(''); input.select(); });
  input.addEventListener('click', () => {
    if (list.hidden) show('');
    if (input.value === selected) input.select();
  });
  input.addEventListener('input', () => show(input.value));
  input.addEventListener('blur', hide);
  input.addEventListener('keydown', event => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (list.hidden) show('');
      const backwards = event.key === 'ArrowUp';
      activate(active === -1 && backwards ? matches.length - 1 : active + (backwards ? -1 : 1));
    } else if (event.key === 'Enter' && !list.hidden) {
      event.preventDefault();
      const exact = matches.findIndex(option => searchText(option.label) === searchText(input.value));
      commit(active >= 0 ? active : Math.max(0,exact));
    } else if (event.key === 'Escape' && !list.hidden) {
      event.preventDefault();
      hide();
      input.select();
    }
  });
  toggle.addEventListener('mousedown', event => event.preventDefault());
  toggle.addEventListener('click', () => {
    const open = !list.hidden;
    input.focus();
    if (open) hide();
    else { show(''); input.select(); }
  });
  list.addEventListener('mousedown', event => event.preventDefault());
  list.addEventListener('click', event => {
    const option = event.target.closest('[data-option]');
    if (option) commit(Number(option.dataset.option));
  });

  return (values,value) => {
    options = [{value:'',label:allLabel}, ...values.map(name=>({value:name,label:name}))];
    selected = value;
    hide();
  };
}
