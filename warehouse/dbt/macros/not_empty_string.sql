{% test not_empty_string(model, column_name) %}
select *
from {{ model }}
where {{ column_name }} is null
   or trim(cast({{ column_name }} as text)) = ''
{% endtest %}

