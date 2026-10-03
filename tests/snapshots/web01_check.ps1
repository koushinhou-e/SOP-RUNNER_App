# 構築作業助手 v2 で生成した確認コマンド / 构建作业助手 v2 生成的确认命令
# 作業: snapshot / サーバ: web01 / 生成日時: 2026-01-01 00:00:00
# このスクリプトは自動実行されません。内容を確認してから手動で実行してください。
# 本脚本不会被自动执行。请审阅后再手动运行。
$ErrorActionPreference = 'Continue'
$env:AWS_PAGER = ''

# ------------------------------------------------------------
Write-Host '### [1] インスタンス基本情報 (check: instance_type,private_ip,ami_id,subnet_id)'
aws ec2 describe-instances --region ap-northeast-1 --instance-ids i-0123456789abcdef0 --query 'Reservations[].Instances[].[InstanceId,InstanceType,State.Name,PrivateIpAddress,ImageId,SubnetId]' --output text --no-cli-pager

# ------------------------------------------------------------
Write-Host '### [2] セキュリティグループ (check: security_group_id)'
aws ec2 describe-instances --region ap-northeast-1 --instance-ids i-0123456789abcdef0 --query 'Reservations[].Instances[].SecurityGroups[].GroupId' --output text --no-cli-pager

# ------------------------------------------------------------
Write-Host '### [3] EBS ボリューム (check: ebs_size_gib)'
aws ec2 describe-volumes --region ap-northeast-1 --filters Name=attachment.instance-id,Values=i-0123456789abcdef0 --query 'Volumes[].[VolumeId,Size,VolumeType,State]' --output text --no-cli-pager

# ------------------------------------------------------------
Write-Host '### [4] AMI 名称 (check: os)'
aws ec2 describe-images --region ap-northeast-1 --image-ids ami-0abcdef1234567890 --query 'Images[].[ImageId,Name]' --output text --no-cli-pager

# ------------------------------------------------------------
Write-Host '### [5] ホスト名 (check: hostname)'
ssh -n -o BatchMode=yes -o ConnectTimeout=10 ec2-user@192.0.2.11 'hostname -f'

# ------------------------------------------------------------
Write-Host '### [6] メモリ (GiB) (check: memory_gib)'
ssh -n -o BatchMode=yes -o ConnectTimeout=10 ec2-user@192.0.2.11 'free -g'

# ------------------------------------------------------------
Write-Host '### [7] vCPU 数 (check: vcpu)'
ssh -n -o BatchMode=yes -o ConnectTimeout=10 ec2-user@192.0.2.11 'nproc'

# ------------------------------------------------------------
Write-Host '### [8] ディスク使用量 (check: ebs_size_gib)'
ssh -n -o BatchMode=yes -o ConnectTimeout=10 ec2-user@192.0.2.11 'df -h /'

# ------------------------------------------------------------
Write-Host '### [9] OS バージョン (check: os)'
ssh -n -o BatchMode=yes -o ConnectTimeout=10 ec2-user@192.0.2.11 'grep PRETTY_NAME /etc/os-release'

